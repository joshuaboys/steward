#!/usr/bin/env node
/**
 * Shared installer. Copies the tree outside node_modules and writes a
 * platform wrapper (sh on Unix, .cmd on Windows). Bootstrapped by
 * install.sh / install.ps1. Does not use npm.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ITEMS = [
  "apps",
  "bin",
  "docs",
  "scripts",
  "src",
  "package.json",
  "wrangler.jsonc",
  "README.md",
  ".dev.vars.example",
  "install.sh",
  "install.ps1",
];

function usage() {
  process.stdout
    .write(`Install steward onto PREFIX/bin (default: ~/.local/bin). Requires Node 22.12+.
Does not use npm.

  node scripts/install.mjs
  node scripts/install.mjs --prefix ~/.local
  node scripts/install.mjs --uninstall

Unix:    curl -fsSL https://raw.githubusercontent.com/joshuaboys/steward/main/install.sh | sh
Windows: irm https://raw.githubusercontent.com/joshuaboys/steward/main/install.ps1 | iex
`);
}

function isTree(dir) {
  return (
    existsSync(join(dir, "bin", "steward.mjs")) &&
    existsSync(join(dir, "src", "steward", "cli", "main.ts")) &&
    existsSync(join(dir, "wrangler.jsonc"))
  );
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  let prefix;
  let src;
  let uninstall = false;
  let wrapper;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--uninstall") {
      uninstall = true;
      continue;
    }
    if (arg === "--prefix") {
      prefix = argv[++i];
      if (!prefix) fail("--prefix needs a directory");
      continue;
    }
    if (arg.startsWith("--prefix=")) {
      prefix = arg.slice("--prefix=".length);
      continue;
    }
    if (arg === "--src") {
      src = argv[++i];
      if (!src) fail("--src needs a directory");
      continue;
    }
    if (arg === "--wrapper") {
      wrapper = argv[++i];
      continue;
    }
    fail(`unknown option: ${arg}`);
  }
  return { prefix, src, uninstall, wrapper };
}

function needNode() {
  const ver = process.versions.node;
  const [major, minor] = ver.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    fail(`steward needs Node 22.12 or later (found ${ver}).`);
  }
}

function resolveSrc(flag) {
  if (flag) {
    if (!isTree(flag)) fail(`--src is not a steward tree: ${flag}`);
    return flag;
  }
  if (process.env.STEWARD_SRC) {
    if (!isTree(process.env.STEWARD_SRC)) {
      fail(`STEWARD_SRC is not a steward tree: ${process.env.STEWARD_SRC}`);
    }
    return process.env.STEWARD_SRC;
  }
  const tree = join(dirname(fileURLToPath(import.meta.url)), "..");
  if (isTree(tree)) return tree;
  fail("no steward tree. Set STEWARD_SRC or run from a clone.");
}

function wrapperKind(explicit) {
  const value = explicit ?? process.env.STEWARD_WRAPPER;
  if (value === "cmd" || value === "sh") return value;
  return process.platform === "win32" ? "cmd" : "sh";
}

function wrapperBody(lib, kind) {
  const entry = join(lib, "bin", "steward.mjs");
  if (kind === "cmd") {
    return `@echo off\r\nnode "${entry}" %*\r\nexit /b %ERRORLEVEL%\r\n`;
  }
  return `#!/bin/sh\nexec "${entry}" "$@"\n`;
}

function copyTree(src, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const item of ITEMS) {
    const from = join(src, item);
    if (!existsSync(from)) continue;
    cpSync(from, join(dest, item), { recursive: true });
  }
  const example = join(dest, ".dev.vars.example");
  const vars = join(dest, ".dev.vars");
  if (existsSync(example) && !existsSync(vars)) {
    cpSync(example, vars);
  }
  const mjs = join(dest, "bin", "steward.mjs");
  if (existsSync(mjs)) {
    try {
      chmodSync(mjs, 0o755);
    } catch {
      /* windows */
    }
  }
}

function addWindowsUserPath(binDir) {
  if (process.platform !== "win32") return;
  const escaped = binDir.replace(/'/g, "''");
  const script = `
    $bin = '${escaped}'
    $p = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($null -eq $p) { $p = '' }
    if ($p -notlike ('*' + $bin + '*')) {
      [Environment]::SetEnvironmentVariable('Path', $bin + ';' + $p, 'User')
      Write-Output 'path-added'
    } else {
      Write-Output 'path-present'
    }
  `;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
  });
  return (result.stdout ?? "").trim();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const prefix = args.prefix ?? process.env.PREFIX ?? join(homedir(), ".local");
  const lib = process.env.STEWARD_LIB ?? join(prefix, "lib", "steward");
  const binDir = join(prefix, "bin");
  const kind = wrapperKind(args.wrapper);
  const bin = join(binDir, kind === "cmd" ? "steward.cmd" : "steward");

  if (args.uninstall) {
    rmSync(lib, { recursive: true, force: true });
    rmSync(join(binDir, "steward"), { force: true });
    rmSync(join(binDir, "steward.cmd"), { force: true });
    process.stdout.write(`removed ${lib} and wrappers in ${binDir}\n`);
    return;
  }

  needNode();
  const src = resolveSrc(args.src);
  copyTree(src, lib);
  mkdirSync(binDir, { recursive: true });
  writeFileSync(bin, wrapperBody(lib, kind));
  if (kind === "sh") {
    try {
      chmodSync(bin, 0o755);
    } catch {
      /* windows */
    }
  }

  process.stdout.write(`installed ${bin}\n`);
  process.stdout.write(`  lib   ${lib}\n`);
  process.stdout.write(`  node  v${process.versions.node}\n`);
  const pathAdded = addWindowsUserPath(binDir);
  if (pathAdded === "path-added") {
    process.stdout.write(`Added ${binDir} to your user PATH. Open a new terminal.\n`);
  } else {
    const pathEnv = process.env.PATH ?? "";
    const onPath = pathEnv.split(pathEnv.includes(";") ? ";" : ":").includes(binDir);
    if (!onPath) {
      process.stdout.write(`Add ${binDir} to PATH, for example:\n`);
      if (process.platform === "win32") {
        process.stdout.write(`  setx PATH "${binDir};%PATH%"\n`);
      } else {
        process.stdout.write(`  export PATH="${binDir}:$PATH"\n`);
      }
    }
  }
  process.stdout.write("run: steward help\n");
}

main();
