import type { RunResult, StewardEvent, Intent, RunRecord } from "../types.ts";
import type { StewardApplication, RunContext } from "../applications/interface.ts";
import type { WorkflowRunFn, WorkflowStep } from "./engine.ts";
import { invokeCapability, type Capability, type ModelFn } from "../capabilities/index.ts";
import { capabilityContext } from "../applications/interface.ts";
import { createApproval } from "../policy/approvals.ts";
import { newId, nowIso } from "../ids.ts";
import type { StewardRepositories } from "../storage/memory-store.ts";
import type { StewardWorld } from "../world.ts";
import type { ProposedAction } from "../types.ts";
import { WaitPause } from "./engine.ts";
import { toTransportEventType } from "../events/names.ts";

export interface RunPayload {
  stewardId: string;
  runId: string;
  applicationId: string;
  event: StewardEvent;
}

export function createStewardRunWorkflow(input: {
  application: StewardApplication;
  store: StewardRepositories;
  world: StewardWorld;
  intent: Intent;
  run: RunRecord;
  model?: ModelFn;
  registerWait: (eventType: string, matcher: Record<string, string>) => void;
  registerApprovalWait: (approvalId: string) => void;
}): WorkflowRunFn<RunPayload> {
  return async (_event, step: WorkflowStep): Promise<RunResult> => {
    const runContext: RunContext = {
      stewardId: input.run.id.startsWith("run") ? (input.store.getIdentity()?.id ?? "") : "",
      run: input.run,
      intent: input.intent,
      event: input.run.triggerEventId
        ? (input.store.getEvent(input.run.triggerEventId) as StewardEvent)
        : (_event.payload.event as StewardEvent),
      store: input.store,
      world: input.world,
      model: input.model,
      invoke: (async (capability, payload, meta) => {
        return step.do(`cap:${capability.id}:${JSON.stringify(payload)}`, async () => {
          return invokeCapability(
            capability as Capability<unknown, unknown>,
            payload,
            capabilityContext(runContext),
            meta,
          );
        });
      }) as RunContext["invoke"],
      waitFor: async (type, matcher) => {
        input.registerWait(type, matcher ?? {});
        return step.waitForEvent(`wait:${type}`, {
          type: toTransportEventType(type),
          matcher,
        });
      },
      requestApproval: async (action: ProposedAction) => {
        const existing = input.store
          .listApprovals()
          .find((row) => row.runId === input.run.id && row.action.id === action.id);
        const approval = existing ?? createApproval(input.run.id, action);
        if (!existing) {
          input.store.putApproval(approval);
          input.store.appendLog({
            ts: nowIso(),
            event: "approval_requested",
            stewardId: input.store.getIdentity()?.id ?? "",
            runId: input.run.id,
            applicationId: input.application.id,
            detail: action.summary,
            data: { approvalId: approval.id, capability: action.capability },
          });
        }
        input.registerApprovalWait(approval.id);
        input.run.waitingFor = "approval.granted";
        input.store.putRun(input.run);
        const granted = await step.waitForEvent<{ decision: string }>("wait:approval", {
          type: "approval_granted",
          matcher: { approvalId: approval.id },
        });
        return granted.decision === "rejected" ? "rejected" : "granted";
      },
    };

    runContext.stewardId = input.store.getIdentity()?.id ?? "";
    if (!runContext.event) {
      runContext.event = _event.payload.event;
    }

    const result = await step.do("application.run", async () => input.application.run(runContext));
    return result as RunResult;
  };
}

export { WaitPause, newId };
