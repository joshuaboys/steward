import type { Autonomy, ProposedAction } from "../types.ts";

export type AuthorityDecision =
  | { allow: true; requireApproval: boolean; reason: string }
  | { allow: false; requireApproval: false; reason: string };

const WRITE_CAPABILITIES = new Set([
  "github.pull_request.create",
  "github.pull_request.comment",
  "github.review.request",
  "github.workflow.rerun",
  "github.pull_request.merge",
]);

const ALWAYS_APPROVE = new Set(["github.pull_request.merge"]);

const PROCESS_MUTATIONS = new Set([
  "github.pull_request.comment",
  "github.review.request",
]);

export function evaluateAuthority(input: {
  capability: string;
  autonomy: Autonomy;
  action: ProposedAction;
}): AuthorityDecision {
  const mutating = WRITE_CAPABILITIES.has(input.capability);
  if (!mutating) {
    return { allow: true, requireApproval: false, reason: "read capability" };
  }
  if (input.autonomy === "observe") {
    return {
      allow: false,
      requireApproval: false,
      reason: "intent autonomy is observe; mutations are denied",
    };
  }
  if (ALWAYS_APPROVE.has(input.capability)) {
    return {
      allow: true,
      requireApproval: true,
      reason: "repository mutation requires explicit approval",
    };
  }
  if (input.autonomy === "supervised" && PROCESS_MUTATIONS.has(input.capability)) {
    return {
      allow: true,
      requireApproval: false,
      reason: "supervised concierge may request review and comment",
    };
  }
  if (input.autonomy === "supervised") {
    return {
      allow: true,
      requireApproval: true,
      reason: "supervised intent requires approval for this mutation",
    };
  }
  return {
    allow: true,
    requireApproval: false,
    reason: "autonomous intent may mutate after precondition check",
  };
}

export function validateActionSchema(action: ProposedAction): string | undefined {
  if (!action.id || !action.capability || !action.summary) {
    return "action is missing identity, capability, or summary";
  }
  if (!action.preconditions || Object.keys(action.preconditions).length === 0) {
    if (WRITE_CAPABILITIES.has(action.capability)) {
      return "mutating action requires at least one external precondition";
    }
  }
  return undefined;
}
