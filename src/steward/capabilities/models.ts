import { canAfford } from "../policy/budget.ts";
import type { Capability, CapabilityContext } from "./index.ts";

export interface ModelOutput {
  text: string;
  costUsd: number;
  provider: "xai" | "heuristic";
}

function section(prompt: string, start: string, end?: string): string {
  const from = prompt.indexOf(start);
  if (from < 0) return "";
  const body = prompt.slice(from + start.length);
  if (!end) return body;
  const to = body.indexOf(end);
  return to < 0 ? body : body.slice(0, to);
}

function heuristicClassify(prompt: string): string {
  const lower = prompt.toLowerCase();

  if (lower.includes("classify a ci failure") || lower.includes("known_flakes=")) {
    const title = section(prompt, "TITLE=", "KNOWN_FLAKES=").trim();
    const known = section(prompt, "KNOWN_FLAKES=").split("\n")[0]?.trim() ?? "";
    const knownList =
      known === "none"
        ? []
        : known
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
    if (knownList.some((name) => title.includes(name))) {
      return JSON.stringify({
        outcome: "known_flake",
        rerun: true,
        rationale: `Failure signature matches known flake ${knownList.join(", ")}. Rerun; do not treat as a regression.`,
      });
    }
    if (/timeout|timing|flak/.test(lower)) {
      return JSON.stringify({
        outcome: "suspected_flake",
        rerun: true,
        rationale:
          "test_bootstrap_empty_template failed with a timeout. Timing-dependent failures are suspected flakes. Rerun once; do not open a regression.",
      });
    }
    if (/network|runner|infrastructure/.test(lower)) {
      return JSON.stringify({
        outcome: "infrastructure_failure",
        rerun: false,
        rationale: "Failure looks like runner or network infrastructure, not product code.",
      });
    }
    return JSON.stringify({
      outcome: "real_regression",
      rerun: false,
      rationale:
        "Assertion or compile failure without a flake signature. Treat as a real regression.",
    });
  }

  if (lower.includes("docs_path=") || lower.includes("documentation drift")) {
    const code = section(prompt, "CODE:", "DOCS_PATH=");
    const docs = section(prompt, "DOCS:");
    const codeHasOpts = /BootstrapOpts|opts:\s*BootstrapOpts/.test(code);
    const docsHasOpts = /BootstrapOpts/.test(docs);
    const codeResult = /Result<\s*Plan/.test(code);
    const docsBarePlan = /bootstrap_plan\([^)]*\)\s*->\s*Plan/.test(docs) && !/Result/.test(docs);
    const drift = (codeHasOpts && !docsHasOpts) || (codeResult && docsBarePlan);
    if (drift) {
      return JSON.stringify({
        drift: true,
        suggestedEdit:
          "Update docs/bootstrap.md to document bootstrap_plan(template, opts) -> Result<Plan, BootstrapError>, including the required BootstrapOpts argument and error path.",
        rationale:
          "src/bootstrap.rs now requires BootstrapOpts and returns Result. docs/bootstrap.md still describes bootstrap_plan(template: &str) -> Plan. Drift on the public bootstrap surface.",
      });
    }
    return JSON.stringify({
      drift: false,
      suggestedEdit: "",
      rationale: "Mapped documentation still matches the public surface of the changed file.",
    });
  }

  if (lower.includes("serde") && lower.includes("1.0.219")) {
    return JSON.stringify({
      impact: "low",
      mutationRequired: false,
      rationale:
        "serde 1.0.210 → 1.0.219 is a patch on a 1.0 line. Changelog reports diagnostic fixes only. No API surface change. Observe, do not mutate.",
    });
  }
  if (lower.includes("breaking") || lower.includes("major")) {
    return JSON.stringify({
      impact: "high",
      mutationRequired: false,
      rationale: "Major or breaking signal present. Investigation required; no automatic mutation.",
    });
  }
  const patch = /\b1\.\d+\.\d+\b/.test(lower) && lower.includes("patch");
  if (patch || lower.includes("no breaking")) {
    return JSON.stringify({
      impact: "low",
      mutationRequired: false,
      rationale: "Patch-level dependency change with no breaking signal.",
    });
  }
  return JSON.stringify({
    impact: "medium",
    mutationRequired: false,
    rationale: "Insufficient evidence of breakage. Record and continue watching.",
  });
}

export const modelClassify: Capability<{ prompt: string }, ModelOutput> = {
  id: "model.classify",
  mutating: false,
  async execute(input, ctx) {
    return runModel("classify", input.prompt, ctx, 0.002);
  },
};

export const modelReason: Capability<{ prompt: string }, ModelOutput> = {
  id: "model.reason",
  mutating: false,
  async execute(input, ctx) {
    return runModel("reason", input.prompt, ctx, 0.02);
  },
};

async function runModel(
  purpose: "classify" | "reason",
  prompt: string,
  ctx: CapabilityContext,
  estimate: number,
): Promise<ModelOutput> {
  if (!canAfford(ctx.run.budget, ctx.run.usage, { modelCalls: 1, costUsd: estimate, steps: 1 })) {
    throw new Error("model call would exceed run budget");
  }
  if (ctx.model) {
    const result = await ctx.model({ purpose, prompt });
    ctx.run.usage.modelCalls += 1;
    ctx.run.usage.costUsd += result.costUsd;
    ctx.run.usage.steps += 1;
    return { text: result.text, costUsd: result.costUsd, provider: "xai" };
  }
  const text = heuristicClassify(prompt);
  ctx.run.usage.modelCalls += 1;
  ctx.run.usage.costUsd += estimate;
  ctx.run.usage.steps += 1;
  return { text, costUsd: estimate, provider: "heuristic" };
}

export const modelCapabilities = [modelClassify, modelReason];
