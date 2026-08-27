import { newId, nowIso } from "../ids.ts";
import { githubFileRead } from "../capabilities/github.ts";
import { modelClassify } from "../capabilities/models.ts";
import type { StewardApplication } from "./interface.ts";
import type { Fact } from "../types.ts";

const CODE_GLOBS = [".rs", ".ts", ".tsx", ".py", ".go", ".sql", ".toml", ".jsonc", ".json"];

function changedFiles(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as Record<string, unknown>;
  const files = new Set<string>();
  const collect = (row: Record<string, unknown>) => {
    for (const key of ["added", "modified", "removed"] as const) {
      const list = row[key];
      if (Array.isArray(list)) {
        for (const file of list) if (typeof file === "string") files.add(file);
      }
    }
  };
  const commits = Array.isArray(body.commits) ? body.commits : [];
  for (const commit of commits) {
    if (commit && typeof commit === "object") collect(commit as Record<string, unknown>);
  }
  const head = body.head_commit;
  if (head && typeof head === "object") collect(head as Record<string, unknown>);
  return [...files];
}

function defaultMap(): Record<string, string[]> {
  return {
    "src/bootstrap.rs": ["docs/bootstrap.md"],
  };
}

function loadMap(facts: Fact[]): Record<string, string[]> {
  const fact = facts.find((row) => row.key === "docs.map");
  const value = fact?.value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const map: Record<string, string[]> = {};
    for (const [code, docs] of Object.entries(value as Record<string, unknown>)) {
      if (Array.isArray(docs))
        map[code] = docs.filter((item): item is string => typeof item === "string");
    }
    if (Object.keys(map).length > 0) return map;
  }
  return defaultMap();
}

function mappedSurfaces(
  files: string[],
  map: Record<string, string[]>,
): Array<{ code: string; docs: string[] }> {
  const hits: Array<{ code: string; docs: string[] }> = [];
  for (const file of files) {
    const docs = map[file];
    if (docs && docs.length > 0) hits.push({ code: file, docs });
  }
  return hits;
}

export const docsWarden: StewardApplication = {
  id: "docs-warden",
  subscriptions: ["github.push"],
  async consider(context, event) {
    const files = changedFiles(event.payload);
    const map = loadMap(context.store.listFacts());
    const hits = mappedSurfaces(files, map);
    if (hits.length === 0) {
      const looksLikeCode = files.some((file) => CODE_GLOBS.some((ext) => file.endsWith(ext)));
      return {
        relevant: false,
        executionClass: "immediate",
        reason: looksLikeCode
          ? `code changed without a documentation mapping: ${files.join(", ") || "none"}`
          : "push did not touch a documented surface",
        applicationId: "docs-warden",
      };
    }
    return {
      relevant: true,
      executionClass: "durable",
      reason: `documented surface changed: ${hits.map((hit) => hit.code).join(", ")}`,
      applicationId: "docs-warden",
    };
  },
  async run(context) {
    const { invoke, store, event, run } = context;
    const files = changedFiles(event.payload);
    const map = loadMap(store.listFacts());
    const hits = mappedSurfaces(files, map);
    if (hits.length === 0) {
      return {
        disposition: "ignored",
        summary: "no documented surface in this push",
        mutations: [],
      };
    }

    const findings: Array<{
      code: string;
      docs: string;
      drift: boolean;
      suggestedEdit: string;
      rationale: string;
    }> = [];

    for (const hit of hits) {
      const codeFile = await invoke(githubFileRead, { path: hit.code });
      const code = codeFile.output?.content ?? "";
      for (const docsPath of hit.docs) {
        const docsFile = await invoke(githubFileRead, { path: docsPath });
        const docs = docsFile.output?.content ?? "";
        const classified = await invoke(modelClassify, {
          prompt: [
            "Classify documentation drift. Do not read any file that is not listed.",
            `SURFACE=${hit.code}`,
            `CODE_PATH=${hit.code}`,
            "CODE:",
            code,
            `DOCS_PATH=${docsPath}`,
            "DOCS:",
            docs,
            "Return JSON {drift, suggestedEdit, rationale}.",
          ].join("\n"),
        });

        let drift = false;
        let suggestedEdit = "";
        let rationale = classified.output?.text ?? "unclassified";
        try {
          const parsed = JSON.parse(classified.output?.text ?? "{}") as {
            drift?: boolean;
            suggestedEdit?: string;
            rationale?: string;
          };
          drift = Boolean(parsed.drift);
          suggestedEdit = parsed.suggestedEdit ?? "";
          rationale = parsed.rationale ?? rationale;
        } catch {
          /* keep heuristic string */
        }

        findings.push({ code: hit.code, docs: docsPath, drift, suggestedEdit, rationale });

        store.putFact({
          key: `docs.surface.${hit.code}`,
          value: {
            code: hit.code,
            docs: docsPath,
            sha: (event.payload as { after?: string }).after,
          },
          sourceEventId: event.id,
          observedAt: nowIso(),
          updatedAt: nowIso(),
        });
        store.putBelief({
          key: `docs.drift.${hit.code}`,
          value: { drift, docs: docsPath, suggestedEdit, rationale },
          confidence: drift ? 0.9 : 0.84,
          evidenceId: event.id,
          observedAt: nowIso(),
          updatedAt: nowIso(),
        });
      }
    }

    const drifted = findings.filter((row) => row.drift);
    store.putDecision({
      id: newId("dec"),
      runId: run.id,
      type: "docs.drift",
      decision: {
        surfaces: findings,
        mutationRequired: false,
        outcome: drifted.length ? "finding" : "in_sync",
      },
      createdAt: nowIso(),
    });

    return {
      disposition: drifted.length ? "finding" : "observed",
      summary: drifted.length
        ? drifted.map((row) => row.rationale).join(" ")
        : "Mapped documentation still describes the changed surface.",
      mutations: [],
    };
  },
};
