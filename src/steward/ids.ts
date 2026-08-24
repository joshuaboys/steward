export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${rand.slice(0, 10)}`;
}

export function runId(): string {
  return newId("run");
}

export function workflowInstanceId(id: string): string {
  return `steward-run_${id}`;
}

export function actionIdentity(stewardId: string, runIdValue: string, actionId: string): string {
  return `${stewardId}:${runIdValue}:${actionId}`;
}

export function digest(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
