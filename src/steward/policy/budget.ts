import type { RunBudget, RunUsage } from "../types.ts";

export class BudgetExceeded extends Error {
  readonly axis: keyof RunBudget;
  readonly usage: RunUsage;
  constructor(axis: keyof RunBudget, usage: RunUsage) {
    super(`run budget exceeded on ${axis}`);
    this.name = "BudgetExceeded";
    this.axis = axis;
    this.usage = usage;
  }
}

export function assertBudget(budget: RunBudget, usage: RunUsage): void {
  if (usage.costUsd > budget.maxCostUsd) throw new BudgetExceeded("maxCostUsd", usage);
  if (usage.modelCalls > budget.maxModelCalls) throw new BudgetExceeded("maxModelCalls", usage);
  if (usage.steps > budget.maxSteps) throw new BudgetExceeded("maxSteps", usage);
  if (usage.capabilityCalls > budget.maxCapabilityCalls) {
    throw new BudgetExceeded("maxCapabilityCalls", usage);
  }
}

export function canAfford(
  budget: RunBudget,
  usage: RunUsage,
  increment: Partial<RunUsage>,
): boolean {
  const next: RunUsage = {
    costUsd: usage.costUsd + (increment.costUsd ?? 0),
    modelCalls: usage.modelCalls + (increment.modelCalls ?? 0),
    steps: usage.steps + (increment.steps ?? 0),
    capabilityCalls: usage.capabilityCalls + (increment.capabilityCalls ?? 0),
  };
  try {
    assertBudget(budget, next);
    return true;
  } catch {
    return false;
  }
}
