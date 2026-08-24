const TRANSPORT_SAFE = /^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/;

export function toTransportEventType(domainType: string): string {
  const mapped = domainType.replace(/\./g, "_");
  if (!TRANSPORT_SAFE.test(mapped)) {
    throw new Error(`Cannot map domain event type to workflow transport: ${domainType}`);
  }
  return mapped;
}

export function fromTransportEventType(transportType: string): string {
  return transportType.replace(/_/g, ".");
}

export const DomainEvents = {
  githubPush: "github.push",
  githubPullRequestOpened: "github.pull_request.opened",
  githubPullRequestSynchronize: "github.pull_request.synchronize",
  githubPullRequestReady: "github.pull_request.ready_for_review",
  githubPullRequestReview: "github.pull_request.review_submitted",
  githubWorkflowCompleted: "github.workflow.completed",
  dependencyRelease: "dependency.release",
  dependencySecurityAdvisory: "dependency.security_advisory",
  scheduleTick: "schedule.tick",
  approvalGranted: "approval.granted",
  approvalRejected: "approval.rejected",
  manualRunRequested: "manual.run_requested",
} as const;
