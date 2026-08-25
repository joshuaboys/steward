import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { StewardRuntime } from "../runtime.ts";
import { runStewardCommand, type CliHost } from "./commands.ts";
import type { StewardProjectConfig } from "./config.ts";

const execFileAsync = promisify(execFile);

function findGitRoot(start: string): string | undefined {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function configPath(root: string) {
  return join(root, ".steward", "config.json");
}

function runtimePath(root: string) {
  return join(root, ".steward", "runtime.json");
}

function globalStateDir() {
  return join(homedir(), ".steward");
}

function loadConfig(root: string): StewardProjectConfig | null {
  const file = configPath(root);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as StewardProjectConfig;
  } catch {
    return null;
  }
}

function loadRuntime(root: string): StewardRuntime {
  const file = runtimePath(root);
  if (existsSync(file)) {
    try {
      return StewardRuntime.restore(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      /* fall through */
    }
  }
  return new StewardRuntime(undefined, { seedDemoSubjects: false });
}

function persist(root: string, runtime: StewardRuntime, config: StewardProjectConfig | null) {
  mkdirSync(join(root, ".steward"), { recursive: true });
  writeFileSync(runtimePath(root), JSON.stringify(runtime.serialize()));
  if (config) writeFileSync(configPath(root), `${JSON.stringify(config, null, 2)}\n`);
}

async function gitRemote(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

async function main() {
  const cwd = process.cwd();
  const root = findGitRoot(cwd) ?? cwd;
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (command === "worker" || command === "deploy") {
    const wranglerArgs = command === "worker" ? ["dev"] : ["deploy"];
    const child = spawn("npx", ["--yes", "wrangler@4", ...wranglerArgs], {
      stdio: "inherit",
      cwd: root,
      env: process.env,
    });
    child.on("exit", (code) => process.exit(code ?? 1));
    return;
  }

  const config = loadConfig(root);
  const runtime = loadRuntime(root);
  if (config) runtime.bind(config.subject.id);

  const host: CliHost = {
    runtime,
    subjectId: config?.subject.id,
    config,
    surface: "cli",
    gitRemote: () => gitRemote(root),
  };

  const result = await runStewardCommand(argv, host);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const nextConfig = result.config ?? config;
  persist(root, runtime, nextConfig ?? null);

  mkdirSync(globalStateDir(), { recursive: true });
  process.exit(result.exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
