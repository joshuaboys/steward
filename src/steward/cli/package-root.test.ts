import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stewardPackageRoot, wranglerInvocation } from "./package-root.ts";

test("wrangler runs from the steward package root, not the caller's git root", () => {
  const pkg = "/opt/steward-install";
  const worker = wranglerInvocation("worker", pkg);
  assert.equal(worker.command, "npx");
  assert.deepEqual(worker.args, ["--yes", "wrangler@4", "dev"]);
  assert.equal(worker.cwd, pkg);

  const deploy = wranglerInvocation("deploy", pkg);
  assert.deepEqual(deploy.args, ["--yes", "wrangler@4", "deploy"]);
  assert.equal(deploy.cwd, pkg);
});

test("stewardPackageRoot is the tree that contains wrangler.jsonc", () => {
  const root = stewardPackageRoot(import.meta.url);
  assert.ok(existsSync(join(root, "wrangler.jsonc")));
  assert.ok(existsSync(join(root, "bin/steward.mjs")));
  assert.ok(existsSync(join(root, "src/steward/cli/main.ts")));
});
