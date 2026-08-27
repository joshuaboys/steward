import { newId, nowIso } from "../ids.ts";
import { githubWorkflowRead, githubWorkflowRerun } from "../capabilities/github.ts";
import { modelClassify } from "../capabilities/models.ts";
import type { StewardApplication } from "./interface.ts";
import type { Fact } from "../types.ts";

type Outcome =
  | "real_regression"
  | "known_flake"
  | "suspected_flake"
  | "infrastructure_failure"
  | "unknown";

function workflowPayload(payload: unknown): {
  headSha?: string;
  conclusion?: string;
  status?: string;
  name?: string;
  title?: string;
} {
  if (!payload || typeof payload !== "object") return {};
  const body = payload as Record<string, unknown>;
  const run = (body.workflow_run ?? body) as Record<string, unknown>;
  return {
    headSha:
      typeof run.head_sha === "string"
        ? run.head_sha
        : typeof body.headSha === "string"
          ? body.headSha
          : undefined,
    conclusion: typeof run.conclusion === "string" ? run.conclusion : undefined,
    status: typeof run.status === "string" ? run.status : undefined,
    name: typeof run.name === "string" ? run.name : undefined,
    title:
      typeof run.display_title === "string"
        ? run.display_title
        : typeof run.name === "string"
          ? run.name
          : undefined,
  };
}

function knownFlakes(facts: Fact[]): string[] {
  const fact = facts.find((row) => row.key === "ci.known_flakes");
  const value = fact?.value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

export const flakyTestWarden: StewardApplication = {
  id: "flaky-test-warden",
  subscriptions: ["github.workflow.completed"],
  async consider(_context, event) {
    const run = workflowPayload(event.payload);
    if (run.conclusion !== "failure") {
      return {
        relevant: false,
        executionClass: "immediate",
        reason:
          run.conclusion === "success"
            ? "CI succeeded; not a failure to classify"
            : "workflow event has no failure",
        applicationId: "flaky-test-warden",
      };
    }
    return {
      relevant: true,
      executionClass: "durable",
      reason: `CI failed on ${run.headSha ?? "unknown sha"}`,
      applicationId: "flaky-test-warden",
    };
  },
  async run(context) {
    const { invoke, store, event, run } = context;
    const payload = workflowPayload(event.payload);
    const headSha = payload.headSha;
    if (!headSha) {
      return { disposition: "ignored", summary: "CI failure has no head SHA", mutations: [] };
    }

    const workflow = await invoke(githubWorkflowRead, { headSha });
    const conclusion = workflow.output?.conclusion ?? payload.conclusion ?? "failure";
    const title = payload.title ?? workflow.output?.name ?? "ci";
    const flakes = knownFlakes(store.listFacts());

    const classified = await invoke(modelClassify, {
      prompt: [
        "Classify a CI failure. Outcomes: real_regression, known_flake, suspected_flake, infrastructure_failure, unknown.",
        `HEAD_SHA=${headSha}`,
        `CONCLUSION=${conclusion}`,
        `TITLE=${title}`,
        `KNOWN_FLAKES=${flakes.join(",") || "none"}`,
        "Return JSON {outcome, rerun, rationale}.",
      ].join("\n"),
    });

    let outcome: Outcome = "unknown";
    let rerun = false;
    let rationale = classified.output?.text ?? "unclassified";
    try {
      const parsed = JSON.parse(classified.output?.text ?? "{}") as {
        outcome?: Outcome;
        rerun?: boolean;
        rationale?: string;
      };
      if (parsed.outcome) outcome = parsed.outcome;
      rerun = Boolean(parsed.rerun);
      rationale = parsed.rationale ?? rationale;
    } catch {
      /* keep heuristic string */
    }

    if (flakes.some((name) => title.includes(name))) {
      outcome = "known_flake";
      rerun = true;
    }

    store.putFact({
      key: `ci.failure.${headSha}`,
      value: { headSha, conclusion, title },
      sourceEventId: event.id,
      observedAt: nowIso(),
      updatedAt: nowIso(),
    });
    store.putBelief({
      key: `ci.flake.${headSha}`,
      value: { outcome, rerun, rationale, title },
      confidence: outcome === "known_flake" ? 0.93 : outcome === "suspected_flake" ? 0.78 : 0.7,
      evidenceId: event.id,
      observedAt: nowIso(),
      updatedAt: nowIso(),
    });

    const mutations: string[] = [];
    if (rerun && (outcome === "suspected_flake" || outcome === "known_flake")) {
      const result = await invoke(
        githubWorkflowRerun,
        { headSha },
        {
          actionId: "ci-rerun_01",
          summary: `Rerun CI for ${title} at ${headSha}`,
          preconditions: { expectedHeadSha: headSha },
        },
      );
      if (result.ok) mutations.push("github.workflow.rerun");
    }

    store.putDecision({
      id: newId("dec"),
      runId: run.id,
      type: "ci.flake",
      decision: { outcome, rerun, mutations, rationale },
      createdAt: nowIso(),
    });

    return {
      disposition: outcome,
      summary: rationale,
      mutations,
    };
  },
};
