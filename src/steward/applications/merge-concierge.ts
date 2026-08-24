import { newId, nowIso } from "../ids.ts";
import {
  githubPullRequestComment,
  githubPullRequestMerge,
  githubPullRequestRead,
  githubReviewRequest,
  githubWorkflowRead,
} from "../capabilities/github.ts";
import type { StewardApplication } from "./interface.ts";
import type { ProposedAction } from "../types.ts";

function prNumber(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const body = payload as Record<string, unknown>;
  const pr = body.pull_request;
  if (pr && typeof pr === "object" && typeof (pr as { number?: unknown }).number === "number") {
    return (pr as { number: number }).number;
  }
  if (typeof body.number === "number") return body.number;
  return undefined;
}

function headSha(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const body = payload as Record<string, unknown>;
  const pr = body.pull_request as { head?: { sha?: string } } | undefined;
  if (pr?.head?.sha) return pr.head.sha;
  const run = body.workflow_run as { head_sha?: string } | undefined;
  if (run?.head_sha) return run.head_sha;
  return undefined;
}

export const mergeConcierge: StewardApplication = {
  id: "merge-concierge",
  subscriptions: [
    "github.pull_request.opened",
    "github.pull_request.synchronize",
    "github.pull_request.ready_for_review",
    "github.pull_request.review_submitted",
    "github.workflow.completed",
    "approval.granted",
  ],
  async consider(_context, event) {
    if (event.type === "github.workflow.completed" || event.type === "approval.granted") {
      return {
        relevant: false,
        executionClass: "durable",
        reason: "resume path handled by wait subscriptions, not a new run",
        applicationId: "merge-concierge",
      };
    }
    const number = prNumber(event.payload);
    if (!number) {
      return {
        relevant: false,
        executionClass: "immediate",
        reason: "event has no pull request",
        applicationId: "merge-concierge",
      };
    }
    return {
      relevant: true,
      executionClass: "durable",
      reason: `PR #${number} entered merge concierge`,
      applicationId: "merge-concierge",
      waitingHint: headSha(event.payload)
        ? { eventType: "github.workflow.completed", matcher: { headSha: headSha(event.payload)! } }
        : undefined,
    };
  },
  async run(context) {
    const { invoke, store, event, run, waitFor, requestApproval } = context;
    const number = prNumber(event.payload);
    if (!number) {
      return { disposition: "ignored", summary: "no pull request", mutations: [] };
    }

    const prResult = await invoke(githubPullRequestRead, { number });
    if (!prResult.ok || !prResult.output) {
      return { disposition: "failed", summary: prResult.error ?? "missing PR", mutations: [] };
    }
    const pr = prResult.output;
    store.putFact({
      key: `pr.${number}.head`,
      value: { number, headSha: pr.headSha, title: pr.title },
      sourceEventId: event.id,
      observedAt: nowIso(),
      updatedAt: nowIso(),
    });
    run.expectedPreconditions = { expectedHeadSha: pr.headSha, pr: String(number) };

    if (!waitFor) {
      return { disposition: "blocked", summary: "durable wait is required for CI", mutations: [] };
    }

    const ciEvent = await waitFor<{ payload?: { conclusion?: string; head_sha?: string } }>(
      "github.workflow.completed",
      { headSha: pr.headSha },
    );

    const workflow = await invoke(githubWorkflowRead, { headSha: pr.headSha });
    const conclusion = workflow.output?.conclusion ?? ciEvent?.payload?.conclusion;
    if (conclusion !== "success") {
      store.putDecision({
        id: newId("dec"),
        runId: run.id,
        type: "merge.blocked",
        decision: { reason: "ci_failed", conclusion },
        createdAt: nowIso(),
      });
      return {
        disposition: "blocked",
        summary: `CI did not succeed for ${pr.headSha}`,
        mutations: [],
      };
    }

    const latest = await invoke(githubPullRequestRead, { number });
    const current = latest.output;
    if (!current || current.headSha !== pr.headSha) {
      return {
        disposition: "superseded",
        summary: `PR #${number} moved from ${pr.headSha} to ${current?.headSha ?? "unknown"}`,
        mutations: [],
      };
    }

    const mutations: string[] = [];
    if (current.requestedReviewers.length === 0 && current.reviews.length === 0) {
      const requested = await invoke(
        githubReviewRequest,
        {
          number,
          reviewers: ["maintainer"],
          expectedHeadSha: current.headSha,
        },
        {
          actionId: "request-review_01",
          summary: `Request review on PR #${number}`,
          preconditions: { expectedHeadSha: current.headSha, pr: String(number) },
        },
      );
      if (requested.ok) {
        mutations.push("github.review.request");
        store.putDecision({
          id: newId("dec"),
          runId: run.id,
          type: "review.requested",
          decision: requested.output,
          createdAt: nowIso(),
        });
      }
    }

    const comment = await invoke(
      githubPullRequestComment,
      {
        number,
        expectedHeadSha: current.headSha,
        body: "CI is green. Steward is ready to merge once approved.",
      },
      {
        actionId: "comment_ci_green",
        summary: `Comment on PR #${number} that CI is green`,
        preconditions: { expectedHeadSha: current.headSha, pr: String(number) },
      },
    );
    if (comment.ok) mutations.push("github.pull_request.comment");

    const mergeAction: ProposedAction = {
      id: "merge_01",
      capability: "github.pull_request.merge",
      input: { number, expectedHeadSha: current.headSha },
      preconditions: { expectedHeadSha: current.headSha, pr: String(number) },
      summary: `Merge PR #${number} at ${current.headSha}`,
    };

    if (requestApproval) {
      const decision = await requestApproval(mergeAction);
      if (decision !== "granted") {
        return {
          disposition: "approval_rejected",
          summary: `Merge of PR #${number} was not approved`,
          mutations,
        };
      }
    }

    const merged = await invoke(githubPullRequestMerge, {
      number,
      expectedHeadSha: current.headSha,
    }, {
      actionId: "merge_01",
      summary: mergeAction.summary,
      preconditions: mergeAction.preconditions,
    });

    if (merged.approvalRequired && requestApproval) {
      const decision = await requestApproval(merged.action!);
      if (decision !== "granted") {
        return {
          disposition: "approval_rejected",
          summary: `Merge of PR #${number} was not approved`,
          mutations,
        };
      }
      const retry = await invoke(githubPullRequestMerge, {
        number,
        expectedHeadSha: current.headSha,
      }, {
        actionId: "merge_01",
        summary: mergeAction.summary,
        preconditions: mergeAction.preconditions,
      });
      if (retry.ok) {
        mutations.push("github.pull_request.merge");
        return {
          disposition: "merged",
          summary: `Merged PR #${number} at ${current.headSha}`,
          mutations,
        };
      }
    }

    if (merged.ok) {
      mutations.push("github.pull_request.merge");
      return {
        disposition: "merged",
        summary: `Merged PR #${number} at ${current.headSha}`,
        mutations,
      };
    }

    return {
      disposition: merged.approvalRequired ? "waiting_approval" : "acted",
      summary: merged.approvalRequired
        ? `Waiting for approval to merge PR #${number}`
        : `PR #${number} advanced; merge not completed (${merged.error ?? "unknown"})`,
      mutations,
      waitingFor: merged.approvalRequired ? "approval.granted" : undefined,
    };
  },
};
