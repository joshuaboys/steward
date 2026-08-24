export type Autonomy = "observe" | "supervised" | "autonomous";

export type ExecutionClass = "immediate" | "durable";

export type RunStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "superseded"
  | "cancelled";

export type EventDisposition =
  | "accepted"
  | "duplicate"
  | "ignored"
  | "run_created"
  | "routed_to_workflow"
  | "state_updated";

export type ApprovalStatus = "pending" | "granted" | "rejected" | "expired";

export interface StewardSubject {
  type: string;
  id: string;
}

export interface StewardEvent<T = unknown> {
  id: string;
  source: string;
  type: string;
  subject: StewardSubject;
  occurredAt: string;
  receivedAt: string;
  correlationId?: string;
  causationId?: string;
  payload: T;
}

export interface EventReceipt {
  eventId: string;
  stewardId: string;
  duplicate: boolean;
  disposition: EventDisposition;
  runId?: string;
  resumedWorkflowInstanceId?: string;
  reason?: string;
}

export interface Intent {
  id: string;
  description: string;
  autonomy: Autonomy;
  applicationId: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  triggerEventId?: string;
  applicationId: string;
  status: RunStatus;
  disposition?: string;
  executionClass: ExecutionClass;
  workflowInstanceId?: string;
  startedAt: string;
  completedAt?: string;
  budget: RunBudget;
  usage: RunUsage;
  waitingFor?: string;
  expectedPreconditions?: Record<string, string>;
}

export interface RunBudget {
  maxCostUsd: number;
  maxModelCalls: number;
  maxSteps: number;
  maxCapabilityCalls: number;
}

export interface RunUsage {
  costUsd: number;
  modelCalls: number;
  steps: number;
  capabilityCalls: number;
}

export interface Fact {
  key: string;
  value: unknown;
  sourceEventId?: string;
  observedAt: string;
  updatedAt: string;
}

export interface Belief {
  key: string;
  value: unknown;
  confidence: number;
  evidenceId?: string;
  observedAt: string;
  updatedAt: string;
}

export interface Decision {
  id: string;
  runId: string;
  type: string;
  decision: unknown;
  createdAt: string;
}

export interface CapabilityCall {
  id: string;
  runId: string;
  capability: string;
  requestDigest?: string;
  responseDigest?: string;
  status: "ok" | "denied" | "failed" | "skipped";
  startedAt: string;
  completedAt?: string;
  note?: string;
}

export interface Approval {
  id: string;
  runId: string;
  action: ProposedAction;
  status: ApprovalStatus;
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface ProposedAction {
  id: string;
  capability: string;
  input: unknown;
  preconditions: Record<string, string>;
  summary: string;
}

export interface Watcher {
  id: string;
  type: string;
  config: Record<string, unknown>;
  cursor?: unknown;
  lastCheckedAt?: string;
  nextCheckAt?: string;
}

export interface StewardSchedule {
  id: string;
  type: "once" | "interval" | "cron";
  specification: string;
  eventType: string;
}

export interface WaitSubscription {
  id: string;
  runId: string;
  workflowInstanceId: string;
  eventType: string;
  transportType: string;
  matcher: Record<string, string>;
  status: "waiting" | "matched" | "cancelled";
}

export interface Consideration {
  relevant: boolean;
  executionClass: ExecutionClass;
  reason: string;
  applicationId: string;
  waitingHint?: {
    eventType: string;
    matcher: Record<string, string>;
  };
}

export interface RunResult {
  disposition: string;
  summary: string;
  mutations: string[];
  waitingFor?: string;
}

export interface StewardIdentity {
  id: string;
  type: "repo";
  subjectType: string;
  subjectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface LogEntry {
  ts: string;
  event: string;
  stewardId: string;
  runId?: string;
  eventId?: string;
  workflowInstanceId?: string;
  applicationId?: string;
  detail?: string;
  data?: Record<string, unknown>;
}

export const DEFAULT_BUDGET: RunBudget = {
  maxCostUsd: 0.5,
  maxModelCalls: 8,
  maxSteps: 24,
  maxCapabilityCalls: 32,
};

export const EMPTY_USAGE: RunUsage = {
  costUsd: 0,
  modelCalls: 0,
  steps: 0,
  capabilityCalls: 0,
};
