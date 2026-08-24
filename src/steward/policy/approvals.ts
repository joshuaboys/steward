import { newId, nowIso } from "../ids.ts";
import type { Approval, ProposedAction } from "../types.ts";

export function createApproval(runId: string, action: ProposedAction): Approval {
  return {
    id: newId("appr"),
    runId,
    action,
    status: "pending",
    requestedAt: nowIso(),
  };
}

export function resolveApproval(
  approval: Approval,
  decision: "granted" | "rejected",
  resolvedBy: string,
): Approval {
  return {
    ...approval,
    status: decision,
    resolvedAt: nowIso(),
    resolvedBy,
  };
}
