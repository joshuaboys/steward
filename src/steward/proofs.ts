import { applyManifestBump, completeCi } from "./world.ts";
import type { StewardRuntime } from "./runtime.ts";
import { newId } from "./ids.ts";
import type { IngressResult } from "./events/ingress.ts";

export type ProofId =
  | "manifest-change"
  | "duplicate-webhook"
  | "merge-concierge"
  | "ci-completed"
  | "registry-tick";

const ANVIL = "eddacraft/anvil-001";
const MANIFEST_DELIVERY = "dep-manifest-001";

export async function runProof(runtime: StewardRuntime, proof: ProofId): Promise<IngressResult> {
  if (proof === "manifest-change") {
    applyManifestBump(
      runtime.world,
      ANVIL,
      "Cargo.toml",
      `[package]\nname = "anvil-001"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1.0.219"\ntokio = { version = "1.40.0", features = ["full"] }\n`,
    );
    return runtime.fireGithub({
      subjectId: ANVIL,
      githubEvent: "push",
      deliveryId: MANIFEST_DELIVERY,
      payload: {
        ref: "refs/heads/main",
        after: "fff111aaa222",
        commits: [
          {
            id: "fff111aaa222",
            message: "bump serde",
            added: [],
            modified: ["Cargo.toml"],
            removed: [],
          },
        ],
        head_commit: {
          id: "fff111aaa222",
          timestamp: new Date().toISOString(),
          added: [],
          modified: ["Cargo.toml"],
          removed: [],
        },
      },
    });
  }

  if (proof === "duplicate-webhook") {
    return runtime.fireGithub({
      subjectId: ANVIL,
      githubEvent: "push",
      deliveryId: MANIFEST_DELIVERY,
      payload: {
        ref: "refs/heads/main",
        after: "fff111aaa222",
        commits: [
          {
            id: "fff111aaa222",
            modified: ["Cargo.toml"],
          },
        ],
      },
    });
  }

  if (proof === "merge-concierge") {
    return runtime.fireGithub({
      subjectId: ANVIL,
      githubEvent: "pull_request",
      deliveryId: newId("pr"),
      payload: {
        action: "ready_for_review",
        number: 42,
        pull_request: {
          number: 42,
          title: "Harden plan bootstrap against empty templates",
          html_url: "https://github.com/eddacraft/anvil-001/pull/42",
          updated_at: new Date().toISOString(),
          head: { sha: "abc123def456" },
          base: { sha: "main000aaa" },
          draft: false,
        },
      },
    });
  }

  if (proof === "ci-completed") {
    completeCi(runtime.world, ANVIL, "abc123def456", "success");
    return runtime.fireGithub({
      subjectId: ANVIL,
      githubEvent: "workflow_run",
      deliveryId: newId("ci"),
      payload: {
        action: "completed",
        workflow_run: {
          id: 9001,
          name: "ci",
          head_sha: "abc123def456",
          conclusion: "success",
          status: "completed",
          updated_at: new Date().toISOString(),
        },
      },
    });
  }

  if (proof === "registry-tick") {
    const receipt = await runtime.manual(ANVIL, "schedule.tick", { scheduleId: "registry-six-hours" });
    return { ok: true, status: 202, stewardId: receipt.stewardId, receipt };
  }

  throw new Error(`unknown proof ${proof}`);
}
