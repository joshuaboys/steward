import {
  DEFAULT_BUDGET,
  EMPTY_USAGE,
  type EventDisposition,
  type EventReceipt,
  type Intent,
  type RunRecord,
  type StewardEvent,
  type StewardIdentity,
} from "./types.ts";
import type { StewardRepositories } from "./storage/memory-store.ts";
import type { StewardWorld } from "./world.ts";
import type { StewardApplication } from "./applications/interface.ts";
import { matchesSubscription } from "./applications/interface.ts";
import { invokeCapability, type ModelFn } from "./capabilities/index.ts";
import { capabilityContext } from "./applications/interface.ts";
import { nowIso, runId, workflowInstanceId, newId } from "./ids.ts";
import { toTransportEventType } from "./events/names.ts";
import { driveWorkflow, type WorkflowInstanceState } from "./workflows/engine.ts";
import { createStewardRunWorkflow, type RunPayload } from "./workflows/steward-run.ts";
import { createApproval, resolveApproval } from "./policy/approvals.ts";

export interface RepoStewardOptions {
  identity: StewardIdentity;
  store: StewardRepositories;
  world: StewardWorld;
  applications: StewardApplication[];
  model?: ModelFn;
}

function payloadHaystack(event: StewardEvent): Record<string, string> {
  const body = (event.payload ?? {}) as Record<string, unknown>;
  const pr = (body.pull_request ?? {}) as Record<string, unknown>;
  const head = (pr.head ?? {}) as Record<string, unknown>;
  const run = (body.workflow_run ?? {}) as Record<string, unknown>;
  const values: Record<string, string> = {};
  const assign = (key: string, value: unknown) => {
    if (typeof value === "string" || typeof value === "number") values[key] = String(value);
  };
  assign("headSha", head.sha ?? run.head_sha ?? body.headSha ?? body.head_sha);
  assign("head_sha", head.sha ?? run.head_sha);
  assign("sha", body.after ?? head.sha);
  assign("number", pr.number ?? body.number);
  assign("pr", pr.number ?? body.number);
  assign("approvalId", body.approvalId);
  assign("conclusion", run.conclusion ?? body.conclusion);
  return values;
}

function matchesWait(matcher: Record<string, string>, event: StewardEvent): boolean {
  const haystack = payloadHaystack(event);
  for (const [key, value] of Object.entries(matcher)) {
    if ((haystack[key] ?? "") !== value) return false;
  }
  return true;
}

function extractDeterministicFacts(event: StewardEvent): Array<{ key: string; value: unknown }> {
  const facts: Array<{ key: string; value: unknown }> = [];
  const body = (event.payload ?? {}) as Record<string, unknown>;
  if (event.type === "github.push") {
    facts.push({
      key: "repo.head",
      value: { sha: body.after, ref: body.ref },
    });
  }
  const pr = body.pull_request as
    | { number?: number; head?: { sha?: string }; title?: string }
    | undefined;
  if (pr?.number) {
    facts.push({
      key: `pr.${pr.number}.observed`,
      value: { number: pr.number, headSha: pr.head?.sha, title: pr.title, type: event.type },
    });
  }
  const run = body.workflow_run as
    | { head_sha?: string; conclusion?: string; status?: string }
    | undefined;
  if (run?.head_sha) {
    facts.push({
      key: `ci.${run.head_sha}`,
      value: { headSha: run.head_sha, conclusion: run.conclusion, status: run.status },
    });
  }
  return facts;
}

export class RepoSteward {
  readonly identity: StewardIdentity;
  readonly store: StewardRepositories;
  readonly world: StewardWorld;
  readonly applications: StewardApplication[];
  readonly workflows = new Map<string, WorkflowInstanceState>();
  private model?: ModelFn;

  constructor(options: RepoStewardOptions) {
    this.identity = options.identity;
    this.store = options.store;
    this.world = options.world;
    this.applications = options.applications;
    this.model = options.model;
    const existing = this.store.getIdentity();
    if (!existing) this.store.putIdentity(options.identity);
  }

  setModel(model?: ModelFn) {
    this.model = model;
  }

  log(
    event: string,
    detail?: string,
    extra?: {
      runId?: string;
      eventId?: string;
      workflowInstanceId?: string;
      applicationId?: string;
      data?: Record<string, unknown>;
    },
  ) {
    this.store.appendLog({
      ts: nowIso(),
      event,
      stewardId: this.identity.id,
      detail,
      ...extra,
    });
  }

  async receiveEvent(event: StewardEvent): Promise<EventReceipt> {
    const inserted = this.store.insertEvent(event);
    if (!inserted) {
      const existing = this.store.getEventDisposition(event.id);
      this.log("event_deduplicated", `duplicate ${event.id}`, { eventId: event.id });
      return {
        eventId: event.id,
        stewardId: this.identity.id,
        duplicate: true,
        disposition: "duplicate",
        runId: existing?.runId,
        reason: "delivery already recorded",
      };
    }
    this.log("event_received", `${event.type}`, { eventId: event.id });

    for (const fact of extractDeterministicFacts(event)) {
      this.store.putFact({
        key: fact.key,
        value: fact.value,
        sourceEventId: event.id,
        observedAt: event.occurredAt,
        updatedAt: nowIso(),
      });
    }

    const resumed = await this.resumeMatchingWorkflows(event);

    const considerations = [];
    for (const application of this.applications) {
      if (!matchesSubscription(application, event.type)) continue;
      const consideration = await application.consider(
        { stewardId: this.identity.id, store: this.store, world: this.world },
        event,
      );
      considerations.push({ application, consideration });
    }

    const relevant = considerations.filter((row) => row.consideration.relevant);
    if (relevant.length === 0) {
      const disposition: EventDisposition = resumed ? "routed_to_workflow" : "ignored";
      this.store.setEventDisposition(event.id, disposition);
      if (!resumed) this.log("event_ignored", "no matching intent", { eventId: event.id });
      return {
        eventId: event.id,
        stewardId: this.identity.id,
        duplicate: false,
        disposition,
        resumedWorkflowInstanceId: resumed,
        reason: resumed ? "resumed waiting workflow" : "no relevant application",
      };
    }

    const chosen = relevant[0];
    const intent = this.intentFor(chosen.application.id);
    const created = await this.createAndStartRun(
      event,
      chosen.application,
      intent,
      chosen.consideration.executionClass,
    );
    const disposition: EventDisposition = "run_created";
    this.store.setEventDisposition(event.id, disposition, created.id);
    return {
      eventId: event.id,
      stewardId: this.identity.id,
      duplicate: false,
      disposition,
      runId: created.id,
      resumedWorkflowInstanceId: resumed,
    };
  }

  private intentFor(applicationId: string): Intent {
    const found = this.store.listIntents().find((row) => row.applicationId === applicationId);
    if (found) return found;
    const intent: Intent = {
      id: applicationId,
      applicationId,
      description: applicationId,
      autonomy: applicationId === "merge-concierge" ? "supervised" : "observe",
      config: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.putIntent(intent);
    return intent;
  }

  private async createAndStartRun(
    event: StewardEvent,
    application: StewardApplication,
    intent: Intent,
    executionClass: "immediate" | "durable",
  ): Promise<RunRecord> {
    const id = runId();
    const wfId = executionClass === "durable" ? workflowInstanceId(id) : undefined;
    const run: RunRecord = {
      id,
      triggerEventId: event.id,
      applicationId: application.id,
      status: "running",
      executionClass,
      workflowInstanceId: wfId,
      startedAt: nowIso(),
      budget: { ...DEFAULT_BUDGET },
      usage: { ...EMPTY_USAGE },
    };
    this.store.putRun(run);
    this.log("run_created", application.id, {
      runId: id,
      eventId: event.id,
      applicationId: application.id,
      workflowInstanceId: wfId,
    });

    if (executionClass === "immediate") {
      const result = await application.run({
        stewardId: this.identity.id,
        run,
        intent,
        event,
        store: this.store,
        world: this.world,
        model: this.model,
        invoke: (capability, input, meta) =>
          invokeCapability(
            capability,
            input,
            capabilityContext({
              stewardId: this.identity.id,
              run,
              intent,
              event,
              store: this.store,
              world: this.world,
              model: this.model,
              invoke: async () => {
                throw new Error("nested");
              },
            }),
            meta,
          ),
      });
      run.status = "completed";
      run.disposition = result.disposition;
      run.completedAt = nowIso();
      this.store.putRun(run);
      this.log("run_completed", result.summary, { runId: run.id, applicationId: application.id });
      return run;
    }

    this.log("workflow_started", application.id, {
      runId: run.id,
      workflowInstanceId: wfId,
      applicationId: application.id,
    });
    await this.driveRun(run, application, intent, event);
    return this.store.getRun(run.id) ?? run;
  }

  private async driveRun(
    run: RunRecord,
    application: StewardApplication,
    intent: Intent,
    event: StewardEvent,
  ) {
    const wfId = run.workflowInstanceId!;
    let state = this.workflows.get(wfId);
    if (!state) {
      state = {
        id: wfId,
        payload: {
          stewardId: this.identity.id,
          runId: run.id,
          applicationId: application.id,
          event,
        } satisfies RunPayload,
        status: "running",
        steps: {},
        receivedEvents: [],
      };
      this.workflows.set(wfId, state);
    }
    const workflow = createStewardRunWorkflow({
      application,
      store: this.store,
      world: this.world,
      intent,
      run,
      model: this.model,
      registerWait: (eventType, matcher) => {
        const already = this.store
          .listWaits()
          .some(
            (row) =>
              row.runId === run.id &&
              row.eventType === eventType &&
              JSON.stringify(row.matcher) === JSON.stringify(matcher) &&
              row.status === "waiting",
          );
        if (already) return;
        this.store.putWait({
          id: newId("wait"),
          runId: run.id,
          workflowInstanceId: wfId,
          eventType,
          transportType: toTransportEventType(eventType),
          matcher,
          status: "waiting",
        });
      },
      registerApprovalWait: (approvalId) => {
        this.store.putWait({
          id: newId("wait"),
          runId: run.id,
          workflowInstanceId: wfId,
          eventType: "approval.granted",
          transportType: "approval_granted",
          matcher: { approvalId },
          status: "waiting",
        });
      },
    });
    const next = await driveWorkflow(state, workflow);
    this.workflows.set(wfId, next);
    const latest = this.store.getRun(run.id) ?? run;
    if (next.status === "waiting") {
      latest.status = "waiting";
      latest.waitingFor = next.waitingType;
      this.store.putRun(latest);
      this.log("workflow_waiting", next.waitingType, {
        runId: latest.id,
        workflowInstanceId: wfId,
        applicationId: application.id,
      });
    } else if (next.status === "complete") {
      const result = next.result as { disposition?: string; summary?: string } | undefined;
      latest.status = "completed";
      latest.disposition = result?.disposition;
      latest.waitingFor = undefined;
      latest.completedAt = nowIso();
      this.store.putRun(latest);
      this.log("run_completed", result?.summary, {
        runId: latest.id,
        workflowInstanceId: wfId,
        applicationId: application.id,
      });
    } else if (next.status === "failed") {
      latest.status = "failed";
      latest.disposition = next.error;
      latest.completedAt = nowIso();
      this.store.putRun(latest);
      this.log("run_failed", next.error, {
        runId: latest.id,
        workflowInstanceId: wfId,
        applicationId: application.id,
      });
    }
  }

  private async resumeMatchingWorkflows(event: StewardEvent): Promise<string | undefined> {
    const waits = this.store.listWaits().filter((row) => row.status === "waiting");
    let resumed: string | undefined;
    for (const wait of waits) {
      const typeOk =
        wait.eventType === event.type || wait.transportType === event.type.replace(/\./g, "_");
      if (!typeOk) continue;
      if (!matchesWait(wait.matcher, event)) continue;
      wait.status = "matched";
      this.store.putWait(wait);
      const state = this.workflows.get(wait.workflowInstanceId);
      if (!state) continue;
      const haystack = {
        ...payloadHaystack(event),
        payload: event.payload,
        approvalId: wait.matcher.approvalId ?? payloadHaystack(event).approvalId,
        decision: event.type.endsWith("rejected") ? "rejected" : "granted",
      };
      state.receivedEvents.push({
        type: wait.transportType,
        payload: haystack,
        consumed: false,
      });
      this.log("workflow_resumed", event.type, {
        runId: wait.runId,
        eventId: event.id,
        workflowInstanceId: wait.workflowInstanceId,
      });
      const run = this.store.getRun(wait.runId);
      const application = this.applications.find((item) => item.id === run?.applicationId);
      const intent = run ? this.intentFor(run.applicationId) : undefined;
      if (run && application && intent) {
        await this.driveRun(run, application, intent, event);
      }
      resumed = wait.workflowInstanceId;
    }
    return resumed;
  }

  async resolveApproval(approvalId: string, decision: "granted" | "rejected", resolvedBy: string) {
    const approval = this.store.getApproval(approvalId);
    if (!approval) throw new Error("approval not found");
    const next = resolveApproval(approval, decision, resolvedBy);
    this.store.putApproval(next);
    const event: StewardEvent = {
      id: `approval-${approvalId}-${decision}`,
      source: "steward",
      type: decision === "granted" ? "approval.granted" : "approval.rejected",
      subject: { type: this.identity.subjectType, id: this.identity.subjectId },
      occurredAt: nowIso(),
      receivedAt: nowIso(),
      payload: { approvalId, decision, action: approval.action },
    };
    return this.receiveEvent(event);
  }

  async requestApprovalForRun(runIdValue: string, action: Parameters<typeof createApproval>[1]) {
    const approval = createApproval(runIdValue, action);
    this.store.putApproval(approval);
    this.log("approval_requested", action.summary, {
      runId: runIdValue,
      data: { approvalId: approval.id },
    });
    return approval;
  }
}
