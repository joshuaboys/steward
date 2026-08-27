import { toTransportEventType } from "../events/names.ts";

export class WaitPause extends Error {
  readonly stepName: string;
  readonly eventType: string;
  readonly transportType: string;
  readonly matcher?: Record<string, string>;
  constructor(
    stepName: string,
    eventType: string,
    transportType: string,
    matcher?: Record<string, string>,
  ) {
    super(`waiting for ${eventType}`);
    this.name = "WaitPause";
    this.stepName = stepName;
    this.eventType = eventType;
    this.transportType = transportType;
    this.matcher = matcher;
  }
}

export interface WorkflowStep {
  do<T>(name: string, fn: () => Promise<T> | T): Promise<T>;
  waitForEvent<T>(
    description: string,
    options: { type: string; timeout?: string; matcher?: Record<string, string> },
  ): Promise<T>;
}

export interface WorkflowEventPayload {
  payload: unknown;
}

export type WorkflowRunFn<P> = (event: { payload: P }, step: WorkflowStep) => Promise<unknown>;

export interface ReceivedWorkflowEvent {
  type: string;
  payload: unknown;
  consumed: boolean;
}

export interface WorkflowInstanceState {
  id: string;
  payload: unknown;
  status: "running" | "waiting" | "complete" | "failed";
  steps: Record<string, unknown>;
  receivedEvents: ReceivedWorkflowEvent[];
  waitingType?: string;
  waitingStep?: string;
  error?: string;
  result?: unknown;
}

export function createStep(state: WorkflowInstanceState): WorkflowStep {
  return {
    async do<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
      if (name in state.steps) return state.steps[name] as T;
      const result = await fn();
      state.steps[name] = result;
      return result;
    },
    async waitForEvent<T>(
      description: string,
      options: { type: string; timeout?: string; matcher?: Record<string, string> },
    ): Promise<T> {
      if (description in state.steps) return state.steps[description] as T;
      const transport = options.type.includes(".")
        ? toTransportEventType(options.type)
        : options.type;
      const existing = state.receivedEvents.find((item) => {
        if (item.consumed) return false;
        if (item.type !== transport && item.type !== options.type) return false;
        if (options.matcher) {
          const payload = item.payload as Record<string, unknown> | undefined;
          const nested = (payload?.payload as Record<string, unknown> | undefined) ?? {};
          const haystack = { ...payload, ...nested };
          for (const [key, value] of Object.entries(options.matcher)) {
            if (String(haystack[key] ?? "") !== value) return false;
          }
        }
        return true;
      });
      if (existing) {
        existing.consumed = true;
        state.steps[description] = existing.payload;
        return existing.payload as T;
      }
      throw new WaitPause(description, options.type, transport, options.matcher);
    },
  };
}

export async function driveWorkflow<P>(
  state: WorkflowInstanceState,
  run: WorkflowRunFn<P>,
): Promise<WorkflowInstanceState> {
  const step = createStep(state);
  try {
    state.status = "running";
    const result = await run({ payload: state.payload as P }, step);
    state.status = "complete";
    state.result = result;
    state.waitingType = undefined;
    state.waitingStep = undefined;
  } catch (error) {
    if (error instanceof WaitPause) {
      state.status = "waiting";
      state.waitingType = error.transportType;
      state.waitingStep = error.stepName;
      return state;
    }
    state.status = "failed";
    state.error = error instanceof Error ? error.message : "workflow failed";
  }
  return state;
}
