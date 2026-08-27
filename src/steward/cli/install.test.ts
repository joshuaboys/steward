import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const installSh = join(repoRoot, "install.sh");

async function withPrefix(fn: (prefix: string) => Promise<void>) {
  const prefix = await mkdtemp(join(tmpdir(), "steward-prefix-"));
  try {
    await fn(prefix);
  } finally {
    await rm(prefix, { recursive: true, force: true });
  }
}

function installEnv(prefix: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PREFIX: prefix,
    STEWARD_SRC: repoRoot,
    HOME: prefix,
    ...extra,
  };
}

test("install.sh is valid POSIX shell", async () => {
  await execFileAsync("sh", ["-n", installSh]);
});

test("install.sh puts a working steward wrapper on PREFIX/bin", async () => {
  await withPrefix(async (prefix) => {
    const { stdout } = await execFileAsync("sh", [installSh], { env: installEnv(prefix) });
    const bin = join(prefix, "bin", "steward");
    const lib = join(prefix, "lib", "steward");
    assert.ok(existsSync(bin), stdout);
    assert.ok(existsSync(join(lib, "src/steward/cli/main.ts")));
    assert.ok(existsSync(join(lib, "wrangler.jsonc")));
    assert.ok(existsSync(join(lib, "bin/steward.mjs")));
    assert.equal(existsSync(join(lib, ".git")), false);
    assert.equal(existsSync(join(lib, "node_modules")), false);

    const { stdout: help } = await execFileAsync(bin, ["help"]);
    assert.match(help, /init \[owner\/repo\]/);
    assert.match(stdout, /installed/);
  });
});

test("install.sh --uninstall removes the lib tree and wrapper", async () => {
  await withPrefix(async (prefix) => {
    await execFileAsync("sh", [installSh], { env: installEnv(prefix) });
    await execFileAsync("sh", [installSh, "--uninstall"], { env: installEnv(prefix) });
    assert.equal(existsSync(join(prefix, "bin", "steward")), false);
    assert.equal(existsSync(join(prefix, "lib", "steward")), false);
  });
});

test("install.sh refuses a Node older than 22.12", async () => {
  await withPrefix(async (prefix) => {
    const fakeBin = join(prefix, "fakebin");
    const { mkdirSync, writeFileSync, chmodSync } = await import("node:fs");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(join(fakeBin, "node"), "#!/bin/sh\necho v18.20.0\n");
    chmodSync(join(fakeBin, "node"), 0o755);
    await assert.rejects(
      () =>
        execFileAsync("sh", [installSh], {
          env: installEnv(prefix, { PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin"}` }),
        }),
      (error: NodeJS.ErrnoException & { stderr?: string }) => {
        assert.match(String(error.stderr ?? error.message), /22\.12/);
        return true;
      },
    );
    assert.equal(existsSync(join(prefix, "bin", "steward")), false);
  });
});
