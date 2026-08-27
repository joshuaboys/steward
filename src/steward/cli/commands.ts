import { durableObjectName, subjectFromGithubRepository } from "../identity.ts";
import { runProof, type ProofId } from "../proofs.ts";
import type { StewardRuntime } from "../runtime.ts";
import { CLI_VERSION, projectConfig, type StewardProjectConfig } from "./config.ts";
import { isRepoId, parseGithubRemote, tokenize } from "./parse.ts";

export const PROOF_NAMES: ProofId[] = [
  "manifest-change",
  "duplicate-webhook",
  "merge-concierge",
  "ci-completed",
  "registry-tick",
  "docs-drift",
  "docs-unmapped",
  "ci-failed",
];

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  select?: string;
  config?: StewardProjectConfig;
}

export interface CliHost {
  runtime: StewardRuntime;
  subjectId: string | undefined;
  config: StewardProjectConfig | null;
  surface: "cli" | "console";
  gitRemote?: () => Promise<string | undefined>;
}

const HELP = `steward ${CLI_VERSION}

Global CLI. The current directory (or selected subject) is the RepoSteward
you are addressing. Wardens are duties on that steward, not extra installs.

  init [owner/repo]   bind this project; creates the steward if needed
  use <owner/repo>    address a different known steward
  status              identity, duties, last activity
  list                every steward this process knows
  duties              standing applications on the current subject
  proof [name]        fire an architecture proof
  approve <id>        grant a pending approval
  reject <id>         reject a pending approval
  reset               wipe in-process runtime
  worker              local Worker (host terminal)
  deploy              wrangler deploy (host terminal)
  console             operations console
  help
`;

function ok(stdout: string, extra: Partial<CliResult> = {}): CliResult {
  return { stdout: stdout.trimEnd() + "\n", stderr: "", exitCode: 0, ...extra };
}

function fail(stderr: string, exitCode = 1): CliResult {
  return { stdout: "", stderr: stderr.trimEnd() + "\n", exitCode };
}

function subjectLine(id: string): string {
  return durableObjectName(subjectFromGithubRepository(id));
}

async function resolveInitTarget(argv: string[], host: CliHost): Promise<string | CliResult> {
  if (argv[0] && isRepoId(argv[0])) return argv[0];
  if (host.gitRemote) {
    const remote = await host.gitRemote();
    if (remote) {
      const parsed = parseGithubRemote(remote);
      if (parsed) return parsed;
    }
  }
  if (host.subjectId) return host.subjectId;
  return fail("init needs owner/repo (or a git origin on github.com)");
}

export async function runStewardCommand(
  input: string | string[],
  host: CliHost,
): Promise<CliResult> {
  const argv = Array.isArray(input) ? [...input] : tokenize(input);
  const command = argv.shift() ?? "help";

  if (command === "help" || command === "-h" || command === "--help") return ok(HELP);
  if (command === "version" || command === "-V" || command === "--version") {
    return ok(`steward ${CLI_VERSION}`);
  }

  if (command === "init") {
    const target = await resolveInitTarget(argv, host);
    if (typeof target !== "string") return target;
    host.runtime.bind(target);
    const config = projectConfig(target);
    return ok(
      [
        `bound ${subjectLine(target)}`,
        `duties  ${config.duties.join(", ")}`,
        host.surface === "cli"
          ? "wrote .steward/config.json  ·  this repo now has a steward"
          : "this console now addresses that steward",
      ].join("\n"),
      { select: target, config },
    );
  }

  if (command === "use") {
    const id = argv[0];
    if (!id || !isRepoId(id)) return fail("use <owner/repo>");
    const stewardId = subjectLine(id);
    if (!host.runtime.getSnapshot().stewards[stewardId]) {
      host.runtime.bind(id);
    }
    return ok(`now addressing ${stewardId}`, { select: id, config: projectConfig(id) });
  }

  if (command === "list") {
    const snap = host.runtime.getSnapshot();
    if (snap.order.length === 0) return ok("(no stewards)");
    const lines = snap.order.map((id) => {
      const view = snap.stewards[id];
      const waiting = view.runs.filter((row) => row.status === "waiting").length;
      const mark = view.identity?.subjectId === host.subjectId ? "*" : " ";
      return `${mark} ${view.identity?.subjectId ?? id}  ${view.intents.length} duties  ${waiting} waiting`;
    });
    return ok(lines.join("\n"));
  }

  if (command === "status" || command === "duties") {
    const id = (argv[0] && isRepoId(argv[0]) ? argv[0] : host.subjectId) ?? host.config?.subject.id;
    if (!id) return fail("no subject. steward init owner/repo");
    const stewardId = subjectLine(id);
    let view = host.runtime.getSnapshot().stewards[stewardId];
    if (!view) {
      host.runtime.bind(id);
      view = host.runtime.getSnapshot().stewards[stewardId];
    }
    const duties = view.intents
      .map((intent) => `  ${intent.applicationId.padEnd(22)} ${intent.autonomy}`)
      .join("\n");
    const last = view.runs[view.runs.length - 1];
    const pending = view.approvals.filter((row) => row.status === "pending");
    if (command === "duties") return ok(duties || "  (none)");
    return ok(
      [
        stewardId,
        `subject   ${id}`,
        `compute   ${view.runs.some((row) => row.status === "running") ? "active" : "idle"}`,
        `runs      ${view.runs.length}${last ? `  last ${last.applicationId} ${last.status}` : ""}`,
        `waiting   ${view.runs.filter((row) => row.status === "waiting").length}`,
        `approvals ${pending.length}`,
        "duties",
        duties || "  (none)",
      ].join("\n"),
    );
  }

  if (command === "proof") {
    const name = argv[0] as ProofId | undefined;
    if (!name) {
      return ok(PROOF_NAMES.map((id) => `  ${id}`).join("\n"));
    }
    if (!PROOF_NAMES.includes(name)) return fail(`unknown proof ${name}`);
    const result = await runProof(host.runtime, name);
    if (!result.ok) return fail(result.error ?? "proof rejected");
    const receipt = result.receipt;
    return ok(
      [
        `proof ${name}`,
        `disposition  ${receipt?.disposition ?? "ok"}`,
        receipt?.runId ? `run          ${receipt.runId}` : undefined,
        receipt?.reason ? `reason       ${receipt.reason}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      { select: "eddacraft/anvil-001" },
    );
  }

  if (command === "approve" || command === "reject") {
    const approvalId = argv[0];
    if (!approvalId) return fail(`${command} <approval-id>`);
    const id = host.subjectId;
    if (!id) return fail("no subject");
    const stewardId = subjectLine(id);
    try {
      await host.runtime.resolveApproval(
        stewardId,
        approvalId,
        command === "approve" ? "granted" : "rejected",
        "operator",
      );
      return ok(`${command}d ${approvalId}`);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "approval failed");
    }
  }

  if (command === "reset") {
    host.runtime.reset();
    return ok("runtime reset", { select: "eddacraft/anvil-001" });
  }

  if (command === "worker" || command === "deploy") {
    if (host.surface === "console") {
      return ok(
        [
          `${command} runs on the host, not inside this console.`,
          `From any terminal:  steward ${command}`,
        ].join("\n"),
      );
    }
    return ok(`run: npx wrangler@4 ${command === "worker" ? "dev" : "deploy"}`);
  }

  if (command === "console") {
    if (host.surface === "console") {
      return ok("this is the operations console. Same commands as `steward` on the host.");
    }
    return ok("operations console: run the steward app, or type commands here with steward <cmd>");
  }

  return fail(`unknown command ${command}. steward help`);
}
