import { digest, newId, nowIso } from "../ids.ts";
import { evaluateAuthority, validateActionSchema } from "../policy/authority.ts";
import { canAfford } from "../policy/budget.ts";
import type {
  Autonomy,
  CapabilityCall,
  ProposedAction,
  RunBudget,
  RunRecord,
  RunUsage,
} from "../types.ts";
import type { StewardRepositories } from "../storage/memory-store.ts";
import type { StewardWorld } from "../world.ts";

export interface CapabilityContext {
  stewardId: string;
  run: RunRecord;
  autonomy: Autonomy;
  store: StewardRepositories;
  world: StewardWorld;
  model?: ModelFn;
}

export type ModelFn = (input: {
  purpose: "classify" | "reason";
  prompt: string;
}) => Promise<{ text: string; costUsd: number }>;

export interface CapabilityResult<T = unknown> {
  ok: boolean;
  output?: T;
  denied?: boolean;
  approvalRequired?: boolean;
  action?: ProposedAction;
  error?: string;
  call: CapabilityCall;
}

export interface Capability<I = unknown, O = unknown> {
  id: string;
  mutating: boolean;
  execute(input: I, context: CapabilityContext): Promise<O>;
}

export class CapabilityDenied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityDenied";
  }
}

export class ApprovalRequired extends Error {
  readonly action: ProposedAction;
  constructor(action: ProposedAction) {
    super(`approval required for ${action.capability}`);
    this.name = "ApprovalRequired";
    this.action = action;
  }
}

export async function invokeCapability<I, O>(
  capability: Capability<I, O>,
  input: I,
  context: CapabilityContext,
  actionMeta?: { summary: string; preconditions: Record<string, string>; actionId: string },
): Promise<CapabilityResult<O>> {
  const usage: RunUsage = { ...context.run.usage };
  const budget: RunBudget = context.run.budget;
  if (!canAfford(budget, usage, { capabilityCalls: 1, steps: 1 })) {
    throw new Error("run budget exhausted before capability invocation");
  }

  const startedAt = nowIso();
  const callId = newId("cap");

  if (capability.mutating) {
    const action: ProposedAction = {
      id: actionMeta?.actionId ?? callId,
      capability: capability.id,
      input,
      preconditions: actionMeta?.preconditions ?? {},
      summary: actionMeta?.summary ?? capability.id,
    };
    const schemaError = validateActionSchema(action);
    if (schemaError) {
      const call = record(context.store, {
        id: callId,
        runId: context.run.id,
        capability: capability.id,
        status: "denied",
        startedAt,
        completedAt: nowIso(),
        note: schemaError,
        requestDigest: digest(input),
      });
      return { ok: false, denied: true, error: schemaError, call };
    }
    const authority = evaluateAuthority({
      capability: capability.id,
      autonomy: context.autonomy,
      action,
    });
    if (!authority.allow) {
      const call = record(context.store, {
        id: callId,
        runId: context.run.id,
        capability: capability.id,
        status: "denied",
        startedAt,
        completedAt: nowIso(),
        note: authority.reason,
        requestDigest: digest(input),
      });
      return { ok: false, denied: true, error: authority.reason, call };
    }
    if (authority.requireApproval) {
      const granted = context.store
        .listApprovals()
        .find(
          (row) =>
            row.runId === context.run.id && row.action.id === action.id && row.status === "granted",
        );
      if (!granted) {
        const call = record(context.store, {
          id: callId,
          runId: context.run.id,
          capability: capability.id,
          status: "skipped",
          startedAt,
          completedAt: nowIso(),
          note: authority.reason,
          requestDigest: digest(input),
        });
        return {
          ok: false,
          approvalRequired: true,
          action,
          error: authority.reason,
          call,
        };
      }
    }
  }

  try {
    const output = await capability.execute(input, context);
    usage.capabilityCalls += 1;
    usage.steps += 1;
    context.run.usage = usage;
    const call = record(context.store, {
      id: callId,
      runId: context.run.id,
      capability: capability.id,
      status: "ok",
      startedAt,
      completedAt: nowIso(),
      requestDigest: digest(input),
      responseDigest: digest(output),
    });
    return { ok: true, output, call };
  } catch (error) {
    const message = error instanceof Error ? error.message : "capability failed";
    const call = record(context.store, {
      id: callId,
      runId: context.run.id,
      capability: capability.id,
      status: "failed",
      startedAt,
      completedAt: nowIso(),
      note: message,
      requestDigest: digest(input),
    });
    return { ok: false, error: message, call };
  }
}

function record(store: StewardRepositories, call: CapabilityCall): CapabilityCall {
  store.putCapabilityCall(call);
  return call;
}
