import { canAfford } from "../policy/budget.ts";
import type { Capability, CapabilityContext } from "./index.ts";

export interface ModelOutput {
  text: string;
  costUsd: number;
  provider: "xai" | "heuristic";
}

function heuristicClassify(prompt: string): string {
  const lower = prompt.toLowerCase();
  const patch = /\b1\.\d+\.\d+\b/.test(lower) && lower.includes("patch");
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
  const text = purpose === "classify" ? heuristicClassify(prompt) : heuristicClassify(prompt);
  ctx.run.usage.modelCalls += 1;
  ctx.run.usage.costUsd += estimate;
  ctx.run.usage.steps += 1;
  return { text, costUsd: estimate, provider: "heuristic" };
}

export const modelCapabilities = [modelClassify, modelReason];
