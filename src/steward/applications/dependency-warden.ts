import { newId, nowIso } from "../ids.ts";
import { githubFileRead, githubRepositoryRead } from "../capabilities/github.ts";
import { modelClassify } from "../capabilities/models.ts";
import { registryReleaseRead } from "../capabilities/registry.ts";
import type { StewardApplication } from "./interface.ts";

const MANIFEST_FILES = ["Cargo.toml", "package.json", "pyproject.toml", "go.mod"];

function changedFiles(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as Record<string, unknown>;
  const commits = Array.isArray(body.commits) ? body.commits : [];
  const files = new Set<string>();
  for (const commit of commits) {
    if (!commit || typeof commit !== "object") continue;
    const row = commit as Record<string, unknown>;
    for (const key of ["added", "modified", "removed"] as const) {
      const list = row[key];
      if (Array.isArray(list)) {
        for (const file of list) if (typeof file === "string") files.add(file);
      }
    }
  }
  const head = body.head_commit;
  if (head && typeof head === "object") {
    const row = head as Record<string, unknown>;
    for (const key of ["added", "modified", "removed"] as const) {
      const list = row[key];
      if (Array.isArray(list)) {
        for (const file of list) if (typeof file === "string") files.add(file);
      }
    }
  }
  return [...files];
}

export const dependencyWarden: StewardApplication = {
  id: "dependency-warden",
  subscriptions: ["github.push", "dependency.release", "schedule.tick"],
  async consider(_context, event) {
    if (event.type === "dependency.release") {
      return {
        relevant: true,
        executionClass: "durable",
        reason: "dependency release requires impact investigation",
        applicationId: "dependency-warden",
      };
    }
    if (event.type === "schedule.tick") {
      return {
        relevant: true,
        executionClass: "immediate",
        reason: "scheduled registry watch",
        applicationId: "dependency-warden",
      };
    }
    const files = changedFiles(event.payload);
    const hit = files.filter((file) => MANIFEST_FILES.some((name) => file.endsWith(name)));
    if (hit.length === 0) {
      return {
        relevant: false,
        executionClass: "immediate",
        reason: "push did not touch a dependency manifest",
        applicationId: "dependency-warden",
      };
    }
    return {
      relevant: true,
      executionClass: "durable",
      reason: `manifest changed: ${hit.join(", ")}`,
      applicationId: "dependency-warden",
    };
  },
  async run(context) {
    const { invoke, store, event, run } = context;
    if (event.type === "schedule.tick") {
      const watchers = store.listWatchers();
      const observed: string[] = [];
      for (const watcher of watchers) {
        if (watcher.type !== "registry.package") continue;
        const name = String(watcher.config.package ?? "");
        const release = await invoke(registryReleaseRead, { name });
        if (!release.ok || !release.output) continue;
        const previous = typeof watcher.cursor === "string" ? watcher.cursor : undefined;
        store.putWatcher({
          ...watcher,
          cursor: release.output.latest,
          lastCheckedAt: nowIso(),
        });
        if (previous && previous !== release.output.latest) {
          observed.push(`${name}:${previous}→${release.output.latest}`);
        }
      }
      store.putFact({
        key: "watcher.last_tick",
        value: { observed },
        sourceEventId: event.id,
        observedAt: nowIso(),
        updatedAt: nowIso(),
      });
      return {
        disposition: observed.length ? "releases_detected" : "no_change",
        summary:
          observed.length > 0
            ? `Registry moved: ${observed.join(", ")}`
            : "Registry watch: no new versions",
        mutations: [],
      };
    }

    const repo = await invoke(githubRepositoryRead, {});
    const manifestPath =
      changedFiles(event.payload).find((file) => MANIFEST_FILES.some((n) => file.endsWith(n))) ??
      "Cargo.toml";
    const file = await invoke(githubFileRead, { path: manifestPath });
    const content = file.output?.content ?? "";
    const serdeMatch = content.match(/serde\s*=\s*"([^"]+)"/);
    const current = serdeMatch?.[1] ?? "unknown";
    const release = await invoke(registryReleaseRead, { name: "serde" });
    const latest = release.output?.latest ?? "unknown";
    const changelog = release.output?.changelog ?? "";

    const classified = await invoke(modelClassify, {
      prompt: `Classify dependency impact. Package serde current=${current} latest=${latest} changelog="${changelog}" manifest=${manifestPath}. Is this a patch? Any breaking change? Return JSON {impact, mutationRequired, rationale}.`,
    });

    let impact = "medium";
    let mutationRequired = false;
    let rationale = classified.output?.text ?? "unclassified";
    try {
      const parsed = JSON.parse(classified.output?.text ?? "{}") as {
        impact?: string;
        mutationRequired?: boolean;
        rationale?: string;
      };
      impact = parsed.impact ?? impact;
      mutationRequired = Boolean(parsed.mutationRequired);
      rationale = parsed.rationale ?? rationale;
    } catch {
      /* keep heuristic string */
    }

    store.putFact({
      key: `dependency.serde.current`,
      value: { current, latest, manifestPath },
      sourceEventId: event.id,
      observedAt: nowIso(),
      updatedAt: nowIso(),
    });
    store.putBelief({
      key: "dependency.serde.impact",
      value: { impact, mutationRequired, rationale },
      confidence: impact === "low" ? 0.86 : 0.62,
      evidenceId: event.id,
      observedAt: nowIso(),
      updatedAt: nowIso(),
    });
    store.putDecision({
      id: newId("dec"),
      runId: run.id,
      type: "dependency.impact",
      decision: {
        impact,
        mutationRequired,
        rationale,
        repository: repo.output?.fullName,
      },
      createdAt: nowIso(),
    });

    return {
      disposition: mutationRequired ? "mutation_proposed" : "observed",
      summary: rationale,
      mutations: [],
    };
  },
};
