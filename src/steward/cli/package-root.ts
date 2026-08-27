import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Directory that contains wrangler.jsonc and src/ — the clone or install prefix, not the caller's repo. */
export function stewardPackageRoot(moduleUrl: string = import.meta.url): string {
  return join(dirname(fileURLToPath(moduleUrl)), "../../..");
}

export function wranglerInvocation(
  command: "worker" | "deploy",
  packageRoot: string,
): { command: string; args: string[]; cwd: string } {
  return {
    command: "npx",
    args: ["--yes", "wrangler@4", command === "worker" ? "dev" : "deploy"],
    cwd: packageRoot,
  };
}
