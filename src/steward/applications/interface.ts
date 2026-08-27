import type { Consideration, RunResult, StewardEvent, RunRecord, Intent } from "../types.ts";
import type { StewardRepositories } from "../storage/memory-store.ts";
import type {
  Capability,
  CapabilityContext,
  CapabilityResult,
  ModelFn,
} from "../capabilities/index.ts";
import type { StewardWorld } from "../world.ts";

export interface StewardContext {
  stewardId: string;
  store: StewardRepositories;
  world: StewardWorld;
}

export interface RunContext {
  stewardId: string;
  run: RunRecord;
  intent: Intent;
  event: StewardEvent;
  store: StewardRepositories;
  world: StewardWorld;
  model?: ModelFn;
  invoke: <I, O>(
    capability: Capability<I, O>,
    input: I,
    meta?: { summary: string; preconditions: Record<string, string>; actionId: string },
  ) => Promise<CapabilityResult<O>>;
  waitFor?: <T>(type: string, matcher?: Record<string, string>) => Promise<T>;
  requestApproval?: (action: import("../types").ProposedAction) => Promise<"granted" | "rejected">;
}

export interface StewardApplication {
  id: string;
  subscriptions: string[];
  consider(context: StewardContext, event: StewardEvent): Promise<Consideration>;
  run(context: RunContext): Promise<RunResult>;
}

export function matchesSubscription(application: StewardApplication, eventType: string): boolean {
  return application.subscriptions.some((pattern) => {
    if (pattern.endsWith(".*")) {
      return eventType.startsWith(pattern.slice(0, -1));
    }
    return pattern === eventType;
  });
}

export function capabilityContext(runContext: RunContext): CapabilityContext {
  return {
    stewardId: runContext.stewardId,
    run: runContext.run,
    autonomy: runContext.intent.autonomy,
    store: runContext.store,
    world: runContext.world,
    model: runContext.model,
  };
}
