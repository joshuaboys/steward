export interface PullRequestState {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  headSha: string;
  baseSha: string;
  mergeable: boolean;
  draft: boolean;
  reviews: Array<{ user: string; state: "approved" | "changes_requested" | "commented" }>;
  requestedReviewers: string[];
  comments: string[];
}

export interface WorkflowRunState {
  id: number;
  name: string;
  headSha: string;
  conclusion: "success" | "failure" | "pending";
  status: "queued" | "in_progress" | "completed";
  reruns: number;
}

export interface RepositoryState {
  fullName: string;
  defaultBranch: string;
  files: Record<string, string>;
  pullRequests: PullRequestState[];
  workflowRuns: WorkflowRunState[];
}

export interface RegistryPackage {
  name: string;
  latest: string;
  changelog: string;
}

export interface StewardWorld {
  repositories: Record<string, RepositoryState>;
  registry: Record<string, RegistryPackage>;
}

export function seedWorld(): StewardWorld {
  return {
    repositories: {
      "eddacraft/anvil-001": {
        fullName: "eddacraft/anvil-001",
        defaultBranch: "main",
        files: {
          "Cargo.toml": `[package]\nname = "anvil-001"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1.0.210"\ntokio = { version = "1.40.0", features = ["full"] }\n`,
          "Cargo.lock": `name = "serde"\nversion = "1.0.210"\n`,
          "src/bootstrap.rs": `/// Bootstrap a plan from a template.\npub fn bootstrap_plan(template: &str) -> Plan {\n    Plan::from_template(template)\n}\n`,
          "src/internal_hash.rs": `pub fn mix(a: u64, b: u64) -> u64 {\n    a ^ b.rotate_left(17)\n}\n`,
          "docs/bootstrap.md": `# Plan bootstrap\n\n\`bootstrap_plan(template: &str) -> Plan\` builds a plan from a template string.\n\nEmpty templates are rejected.\n`,
        },
        pullRequests: [
          {
            number: 42,
            title: "Harden plan bootstrap against empty templates",
            state: "open",
            headSha: "abc123def456",
            baseSha: "main000aaa",
            mergeable: true,
            draft: false,
            reviews: [],
            requestedReviewers: [],
            comments: [],
          },
        ],
        workflowRuns: [
          {
            id: 9001,
            name: "ci",
            headSha: "abc123def456",
            conclusion: "pending",
            status: "in_progress",
            reruns: 0,
          },
        ],
      },
      "joshuaboys/occam": {
        fullName: "joshuaboys/occam",
        defaultBranch: "main",
        files: {
          "package.json": `{"name":"occam","dependencies":{"zod":"4.0.0"}}\n`,
        },
        pullRequests: [
          {
            number: 7,
            title: "Tighten authority gate tests",
            state: "open",
            headSha: "occamsha007",
            baseSha: "occammain",
            mergeable: true,
            draft: false,
            reviews: [{ user: "joshuaboys", state: "approved" }],
            requestedReviewers: [],
            comments: [],
          },
        ],
        workflowRuns: [
          {
            id: 77,
            name: "ci",
            headSha: "occamsha007",
            conclusion: "success",
            status: "completed",
            reruns: 0,
          },
        ],
      },
      "joshuaboys/forge": {
        fullName: "joshuaboys/forge",
        defaultBranch: "main",
        files: {
          "pyproject.toml": `[project]\nname = "forge"\nversion = "0.2.0"\ndependencies = ["httpx==0.27.0"]\n`,
        },
        pullRequests: [],
        workflowRuns: [],
      },
    },
    registry: {
      serde: {
        name: "serde",
        latest: "1.0.219",
        changelog: "1.0.219: no breaking changes; diagnostic fixes only.",
      },
      tokio: {
        name: "tokio",
        latest: "1.40.0",
        changelog: "already current.",
      },
      zod: {
        name: "zod",
        latest: "4.1.0",
        changelog: "4.1.0: minor parser performance, no breaking changes.",
      },
      httpx: {
        name: "httpx",
        latest: "0.27.2",
        changelog: "0.27.2: patch for timeout handling.",
      },
    },
  };
}

export function applyManifestBump(world: StewardWorld, fullName: string, file: string, next: string) {
  const repo = world.repositories[fullName];
  if (!repo) return;
  repo.files[file] = next;
}

export function completeCi(world: StewardWorld, fullName: string, headSha: string, conclusion: "success" | "failure") {
  const repo = world.repositories[fullName];
  if (!repo) return;
  const run = repo.workflowRuns.find((item) => item.headSha === headSha);
  if (run) {
    run.status = "completed";
    run.conclusion = conclusion;
  } else {
    repo.workflowRuns.push({
      id: Date.now() % 100000,
      name: "ci",
      headSha,
      status: "completed",
      conclusion,
      reruns: 0,
    });
  }
}
