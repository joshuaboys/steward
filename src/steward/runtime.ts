import { RepoSteward } from "./steward.ts";
import { MemoryStore, type StewardSnapshot } from "./storage/memory-store.ts";
import { seedWorld, type StewardWorld } from "./world.ts";
import { dependencyWarden } from "./applications/dependency-warden.ts";
import { mergeConcierge } from "./applications/merge-concierge.ts";
import { docsWarden } from "./applications/docs-warden.ts";
import { flakyTestWarden } from "./applications/flaky-test-warden.ts";
import { durableObjectName, parseGithubRepository, subjectFromGithubRepository } from "./identity.ts";
import { nowIso } from "./ids.ts";
import { ingestGithubWebhook } from "./events/ingress.ts";
import { DEMO_WEBHOOK_SECRET, signGithubWebhook } from "./events/verify.ts";
import { normaliseManualEvent } from "./events/normalise.ts";
import type { EventReceipt, LogEntry, StewardEvent } from "./types.ts";
import type { GithubWebhookEnvelope } from "./events/normalise.ts";
import type { ModelFn } from "./capabilities/index.ts";
import type { WorkflowInstanceState } from "./workflows/engine.ts";

export const DEMO_REPOS = ["eddacraft/anvil-001", "joshuaboys/occam", "joshuaboys/forge"] as const;

export interface StewardView {
  identity: ReturnType<RepoSteward["store"]["getIdentity"]>;
  intents: ReturnType<RepoSteward["store"]["listIntents"]>;
  events: ReturnType<RepoSteward["store"]["listEvents"]>;
  runs: ReturnType<RepoSteward["store"]["listRuns"]>;
  facts: ReturnType<RepoSteward["store"]["listFacts"]>;
  beliefs: ReturnType<RepoSteward["store"]["listBeliefs"]>;
  decisions: ReturnType<RepoSteward["store"]["listDecisions"]>;
  capabilityCalls: ReturnType<RepoSteward["store"]["listCapabilityCalls"]>;
  approvals: ReturnType<RepoSteward["store"]["listApprovals"]>;
  watchers: ReturnType<RepoSteward["store"]["listWatchers"]>;
  waits: ReturnType<RepoSteward["store"]["listWaits"]>;
  schedules: ReturnType<RepoSteward["store"]["listSchedules"]>;
  logs: LogEntry[];
  workflows: WorkflowInstanceState[];
  repository: StewardWorld["repositories"][string] | undefined;
}

export interface RuntimeSnapshot {
  world: StewardWorld;
  stewards: Record<string, StewardSnapshot>;
  workflows: Record<string, WorkflowInstanceState[]>;
}

export class StewardRuntime {
  world: StewardWorld;
  stewards = new Map<string, RepoSteward>();
  private listeners = new Set<() => void>();
  private cached: RuntimeView;
  model?: ModelFn;

  constructor(world = seedWorld(), options: { seedDemoSubjects?: boolean } = {}) {
    this.world = world;
    if (options.seedDemoSubjects !== false) {
      for (const fullName of DEMO_REPOS) this.ensure(fullName);
    }
    this.cached = this.buildView();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): RuntimeView {
    return this.cached;
  }

  private emit() {
    this.cached = this.buildView();
    for (const listener of this.listeners) listener();
  }

  ensure(fullName: string): RepoSteward {
    const id = durableObjectName(subjectFromGithubRepository(fullName));
    const existing = this.stewards.get(id);
    if (existing) return existing;
    const store = new MemoryStore();
    const steward = new RepoSteward({
      identity: {
        id,
        type: "repo",
        subjectType: "github.repository",
        subjectId: fullName,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
      store,
      world: this.world,
      applications: [dependencyWarden, mergeConcierge, docsWarden, flakyTestWarden],
      model: this.model,
    });
    this.seedStanding(steward, fullName);
    this.stewards.set(id, steward);
    return steward;
  }

  bind(fullName: string): RepoSteward {
    parseGithubRepository(fullName);
    if (!this.world.repositories[fullName]) {
      this.world.repositories[fullName] = {
        fullName,
        defaultBranch: "main",
        files: {},
        pullRequests: [],
        workflowRuns: [],
      };
    }
    const steward = this.ensure(fullName);
    this.emit();
    return steward;
  }

  private seedStanding(steward: RepoSteward, fullName: string) {
    const ts = nowIso();
    steward.store.putIntent({
      id: "dependency-warden",
      applicationId: "dependency-warden",
      description: "Watch manifests and registry releases. Investigate impact. Do not mutate.",
      autonomy: "observe",
      config: {},
      createdAt: ts,
      updatedAt: ts,
    });
    steward.store.putIntent({
      id: "merge-concierge",
      applicationId: "merge-concierge",
      description: "Move ready pull requests toward merge. Request review. Merge only with approval.",
      autonomy: "supervised",
      config: {},
      createdAt: ts,
      updatedAt: ts,
    });
    steward.store.putIntent({
      id: "docs-warden",
      applicationId: "docs-warden",
      description: "Documentation should describe current software behaviour. Observe drift. Do not mutate.",
      autonomy: "observe",
      config: {},
      createdAt: ts,
      updatedAt: ts,
    });
    steward.store.putIntent({
      id: "flaky-test-warden",
      applicationId: "flaky-test-warden",
      description: "CI failures should represent meaningful failures. Classify flakes. Rerun suspected flakes.",
      autonomy: "supervised",
      config: {},
      createdAt: ts,
      updatedAt: ts,
    });
    steward.store.putFact({
      key: "ci.known_flakes",
      value: ["test_plan_render_race"],
      observedAt: ts,
      updatedAt: ts,
    });
    steward.store.putFact({
      key: "docs.map",
      value: { "src/bootstrap.rs": ["docs/bootstrap.md"] },
      observedAt: ts,
      updatedAt: ts,
    });
    steward.store.putWatcher({
      id: "watch-serde",
      type: "registry.package",
      config: { package: "serde", ecosystem: "crates.io" },
      cursor: this.world.registry.serde?.latest,
    });
    steward.store.putSchedule({
      id: "registry-six-hours",
      type: "interval",
      specification: "6h",
      eventType: "schedule.tick",
    });
    steward.store.putFact({
      key: "subject",
      value: { fullName, runtime: "cloudflare-simulated" },
      observedAt: ts,
      updatedAt: ts,
    });
  }

  async deliver(event: StewardEvent): Promise<EventReceipt> {
    const steward = this.ensure(event.subject.id);
    const receipt = await steward.receiveEvent(event);
    this.emit();
    return receipt;
  }

  async ingestSignedGithub(envelope: GithubWebhookEnvelope, rawBody: string, secret = DEMO_WEBHOOK_SECRET) {
    const result = await ingestGithubWebhook({
      contentType: "application/json",
      envelope,
      rawBody,
      secret,
      deliver: async (_id, event) => this.deliver(event),
    });
    this.emit();
    return result;
  }

  async fireGithub(input: {
    subjectId: string;
    githubEvent: string;
    deliveryId: string;
    payload: Record<string, unknown>;
    secret?: string;
  }) {
    const body = {
      ...input.payload,
      repository: {
        full_name: input.subjectId,
        name: input.subjectId.split("/")[1],
        owner: { login: input.subjectId.split("/")[0] },
      },
    };
    const rawBody = JSON.stringify(body);
    const signature = await signGithubWebhook(input.secret ?? DEMO_WEBHOOK_SECRET, rawBody);
    return this.ingestSignedGithub(
      {
        headers: {
          event: input.githubEvent,
          deliveryId: input.deliveryId,
          signature,
        },
        body,
      },
      rawBody,
    );
  }

  async manual(subjectId: string, type: string, payload: unknown = {}, id?: string) {
    const event = normaliseManualEvent({ id, type, subjectId, payload });
    return this.deliver(event);
  }

  async resolveApproval(stewardId: string, approvalId: string, decision: "granted" | "rejected", resolvedBy = "human") {
    const steward = this.stewards.get(stewardId);
    if (!steward) throw new Error("steward not found");
    const receipt = await steward.resolveApproval(approvalId, decision, resolvedBy);
    this.emit();
    return receipt;
  }

  reset() {
    this.world = seedWorld();
    this.stewards.clear();
    for (const fullName of DEMO_REPOS) this.ensure(fullName);
    this.emit();
  }

  serialize(): RuntimeSnapshot {
    const stewards: Record<string, StewardSnapshot> = {};
    const workflows: Record<string, WorkflowInstanceState[]> = {};
    for (const [id, steward] of this.stewards) {
      stewards[id] = steward.store.snapshot();
      workflows[id] = [...steward.workflows.values()];
    }
    return { world: this.world, stewards, workflows };
  }

  hydrate(snapshot: RuntimeSnapshot) {
    this.world = snapshot.world;
    this.stewards.clear();
    for (const [id, data] of Object.entries(snapshot.stewards)) {
      const steward = this.ensure(data.identity?.subjectId ?? id.replace(/^github:/, ""));
      steward.store.restore(data);
      steward.setModel(this.model);
      steward.workflows.clear();
      for (const wf of snapshot.workflows[id] ?? []) {
        steward.workflows.set(wf.id, wf);
      }
    }
    this.emit();
  }

  static restore(snapshot: RuntimeSnapshot, model?: ModelFn): StewardRuntime {
    const runtime = new StewardRuntime(snapshot.world, { seedDemoSubjects: false });
    runtime.model = model;
    runtime.hydrate(snapshot);
    return runtime;
  }

  private buildView(): RuntimeView {
    const stewards: Record<string, StewardView> = {};
    let waiting = 0;
    let running = 0;
    let logs: LogEntry[] = [];
    for (const [id, steward] of this.stewards) {
      const runs = steward.store.listRuns();
      waiting += runs.filter((row) => row.status === "waiting").length;
      running += runs.filter((row) => row.status === "running").length;
      const view: StewardView = {
        identity: steward.store.getIdentity(),
        intents: steward.store.listIntents(),
        events: steward.store.listEvents(),
        runs,
        facts: steward.store.listFacts(),
        beliefs: steward.store.listBeliefs(),
        decisions: steward.store.listDecisions(),
        capabilityCalls: steward.store.listCapabilityCalls(),
        approvals: steward.store.listApprovals(),
        watchers: steward.store.listWatchers(),
        waits: steward.store.listWaits(),
        schedules: steward.store.listSchedules(),
        logs: steward.store.listLogs(),
        workflows: [...steward.workflows.values()],
        repository: this.world.repositories[steward.identity.subjectId],
      };
      stewards[id] = view;
      logs = logs.concat(view.logs);
    }
    logs.sort((a, b) => a.ts.localeCompare(b.ts));
    return {
      stewards,
      order: [...this.stewards.keys()],
      waiting,
      running,
      computeActive: running > 0,
      logs,
      world: this.world,
    };
  }
}

export interface RuntimeView {
  stewards: Record<string, StewardView>;
  order: string[];
  waiting: number;
  running: number;
  computeActive: boolean;
  logs: LogEntry[];
  world: StewardWorld;
}
