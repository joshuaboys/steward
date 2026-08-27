import assert from "node:assert/strict";
import test from "node:test";
import { StewardRuntime } from "../runtime.ts";
import { runStewardCommand } from "./commands.ts";
import { parseGithubRemote, tokenize } from "./parse.ts";

function host(runtime = new StewardRuntime(), subjectId = "eddacraft/anvil-001") {
  return { runtime, subjectId, config: null, surface: "cli" as const };
}

test("tokenize strips the steward prefix", () => {
  assert.deepEqual(tokenize("steward status"), ["status"]);
  assert.deepEqual(tokenize('init "joshuaboys/portals"'), ["init", "joshuaboys/portals"]);
});

test("parse github remotes", () => {
  assert.equal(parseGithubRemote("git@github.com:joshuaboys/steward.git"), "joshuaboys/steward");
  assert.equal(
    parseGithubRemote("https://github.com/eddacraft/anvil-001.git"),
    "eddacraft/anvil-001",
  );
  assert.equal(parseGithubRemote("joshuaboys/portals"), "joshuaboys/portals");
});

test("init binds a repo that was not a demo subject", async () => {
  const runtime = new StewardRuntime(undefined, { seedDemoSubjects: false });
  const result = await runStewardCommand("init joshuaboys/portals", host(runtime, undefined));
  assert.equal(result.exitCode, 0);
  assert.equal(result.select, "joshuaboys/portals");
  assert.ok(runtime.getSnapshot().stewards["github:joshuaboys/portals"]);
  assert.equal(result.config?.subject.id, "joshuaboys/portals");
});

test("status lists duties on the current subject", async () => {
  const result = await runStewardCommand("status", host());
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /docs-warden/);
  assert.match(result.stdout, /flaky-test-warden/);
});

test("proof manifest-change creates a run", async () => {
  const runtime = new StewardRuntime();
  const result = await runStewardCommand(["proof", "manifest-change"], host(runtime));
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /run_created|investigated|ok/);
  assert.ok(runtime.getSnapshot().stewards["github:eddacraft/anvil-001"].runs.length > 0);
});

test("unknown command fails", async () => {
  const result = await runStewardCommand("frobnicate", host());
  assert.equal(result.exitCode, 1);
});

test("init without target uses git remote when provided", async () => {
  const runtime = new StewardRuntime(undefined, { seedDemoSubjects: false });
  const result = await runStewardCommand("init", {
    runtime,
    subjectId: undefined,
    config: null,
    surface: "cli",
    gitRemote: async () => "git@github.com:eddacraft/forge.git",
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.select, "eddacraft/forge");
});
