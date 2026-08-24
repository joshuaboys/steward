import type { Capability, CapabilityContext } from "./index.ts";
import type { PullRequestState, RepositoryState } from "../world.ts";

function repo(ctx: CapabilityContext, fullName?: string): RepositoryState {
  const id = fullName ?? ctx.store.getIdentity()?.subjectId;
  if (!id) throw new Error("missing repository identity");
  const found = ctx.world.repositories[id];
  if (!found) throw new Error(`repository ${id} is not in the capability world`);
  return found;
}

export const githubRepositoryRead: Capability<{ fullName?: string }, RepositoryState> = {
  id: "github.repository.read",
  mutating: false,
  async execute(input, ctx) {
    return structuredClone(repo(ctx, input.fullName));
  },
};

export const githubFileRead: Capability<{ path: string }, { path: string; content: string }> = {
  id: "github.file.read",
  mutating: false,
  async execute(input, ctx) {
    const repository = repo(ctx);
    const content = repository.files[input.path];
    if (content === undefined) throw new Error(`file not found: ${input.path}`);
    return { path: input.path, content };
  },
};

export const githubPullRequestRead: Capability<{ number: number }, PullRequestState> = {
  id: "github.pull_request.read",
  mutating: false,
  async execute(input, ctx) {
    const pr = repo(ctx).pullRequests.find((item) => item.number === input.number);
    if (!pr) throw new Error(`pull request ${input.number} not found`);
    return structuredClone(pr);
  },
};

export const githubWorkflowRead: Capability<
  { headSha: string },
  { headSha: string; conclusion: string; status: string; name: string }
> = {
  id: "github.workflow.read",
  mutating: false,
  async execute(input, ctx) {
    const run = repo(ctx).workflowRuns.find((item) => item.headSha === input.headSha);
    if (!run) throw new Error(`workflow run for ${input.headSha} not found`);
    return structuredClone(run);
  },
};

export const githubReviewRequest: Capability<
  { number: number; reviewers: string[]; expectedHeadSha: string },
  { number: number; requestedReviewers: string[] }
> = {
  id: "github.review.request",
  mutating: true,
  async execute(input, ctx) {
    const pr = repo(ctx).pullRequests.find((item) => item.number === input.number);
    if (!pr) throw new Error(`pull request ${input.number} not found`);
    if (pr.headSha !== input.expectedHeadSha) {
      throw new Error(`stale head SHA: expected ${input.expectedHeadSha}, actual ${pr.headSha}`);
    }
    const already = new Set(pr.requestedReviewers);
    for (const reviewer of input.reviewers) already.add(reviewer);
    pr.requestedReviewers = [...already];
    return { number: pr.number, requestedReviewers: [...pr.requestedReviewers] };
  },
};

export const githubPullRequestComment: Capability<
  { number: number; body: string; expectedHeadSha: string },
  { number: number; comments: number }
> = {
  id: "github.pull_request.comment",
  mutating: true,
  async execute(input, ctx) {
    const pr = repo(ctx).pullRequests.find((item) => item.number === input.number);
    if (!pr) throw new Error(`pull request ${input.number} not found`);
    if (pr.headSha !== input.expectedHeadSha) {
      throw new Error(`stale head SHA: expected ${input.expectedHeadSha}, actual ${pr.headSha}`);
    }
    pr.comments.push(input.body);
    return { number: pr.number, comments: pr.comments.length };
  },
};

export const githubPullRequestMerge: Capability<
  { number: number; expectedHeadSha: string },
  { number: number; state: "merged" }
> = {
  id: "github.pull_request.merge",
  mutating: true,
  async execute(input, ctx) {
    const pr = repo(ctx).pullRequests.find((item) => item.number === input.number);
    if (!pr) throw new Error(`pull request ${input.number} not found`);
    if (pr.headSha !== input.expectedHeadSha) {
      throw new Error(`stale head SHA: expected ${input.expectedHeadSha}, actual ${pr.headSha}`);
    }
    if (!pr.mergeable) throw new Error("pull request is not mergeable");
    pr.state = "merged";
    return { number: pr.number, state: "merged" };
  },
};

export const githubCapabilities = [
  githubRepositoryRead,
  githubFileRead,
  githubPullRequestRead,
  githubWorkflowRead,
  githubReviewRequest,
  githubPullRequestComment,
  githubPullRequestMerge,
];
