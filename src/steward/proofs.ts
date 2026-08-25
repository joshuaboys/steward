import { applyManifestBump, completeCi } from "./world.ts";
import type { StewardRuntime } from "./runtime.ts";
import { newId } from "./ids.ts";
import type { IngressResult } from "./events/ingress.ts";

export type ProofId =
  | "manifest-change"
  | "duplicate-webhook"
  | "merge-concierge"
  | "ci-completed"
  | "registry-tick"
  | "docs-drift"
  | "docs-unmapped"
  | "ci-failed";

const ANVIL = "eddacraft/anvil-001";
const MANIFEST_DELIVERY = "dep-manifest-001";
const DOCS_DELIVERY = "docs-bootstrap-001";
const UNMAPPED_DELIVERY = "docs-internal-001";

const DRIFTED_BOOTSTRAP = `/// Bootstrap a plan from a template and required options.
pub fn bootstrap_plan(template: &str, opts: BootstrapOpts) -> Result<Plan, BootstrapError> {
    Plan::from_template(template, opts)
}
`;

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

  if (proof === "docs-drift") {
    applyManifestBump(runtime.world, ANVIL, "src/bootstrap.rs", DRIFTED_BOOTSTRAP);
    return runtime.fireGithub({
      subjectId: ANVIL,
      githubEvent: "push",
      deliveryId: DOCS_DELIVERY,
      payload: {
        ref: "refs/heads/main",
        after: "docsapi001",
        commits: [
          {
            id: "docsapi001",
            message: "require BootstrapOpts on plan bootstrap",
            added: [],
            modified: ["src/bootstrap.rs"],
            removed: [],
          },
        ],
        head_commit: {
          id: "docsapi001",
          timestamp: new Date().toISOString(),
          added: [],
          modified: ["src/bootstrap.rs"],
          removed: [],
        },
      },
    });
  }

  if (proof === "docs-unmapped") {
    applyManifestBump(
      runtime.world,
      ANVIL,
      "src/internal_hash.rs",
      `pub fn mix(a: u64, b: u64) -> u64 {\n    a.wrapping_add(b)\n}\n`,
    );
    return runtime.fireGithub({
      subjectId: ANVIL,
      githubEvent: "push",
      deliveryId: UNMAPPED_DELIVERY,
      payload: {
        ref: "refs/heads/main",
        after: "internal009",
        commits: [
          {
            id: "internal009",
            message: "tweak internal mix",
            added: [],
            modified: ["src/internal_hash.rs"],
            removed: [],
          },
        ],
        head_commit: {
          id: "internal009",
          timestamp: new Date().toISOString(),
          added: [],
          modified: ["src/internal_hash.rs"],
          removed: [],
        },
      },
    });
  }

  if (proof === "ci-failed") {
    completeCi(runtime.world, ANVIL, "flake00dead", "failure");
    return runtime.fireGithub({
      subjectId: ANVIL,
      githubEvent: "workflow_run",
      deliveryId: newId("flake"),
      payload: {
        action: "completed",
        workflow_run: {
          id: 9102,
          name: "ci",
          head_sha: "flake00dead",
          conclusion: "failure",
          status: "completed",
          display_title: "test_bootstrap_empty_template timed out after 30s",
          updated_at: new Date().toISOString(),
        },
      },
    });
  }

  throw new Error(`unknown proof ${proof}`);
}
