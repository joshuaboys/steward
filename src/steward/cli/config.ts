export const CLI_VERSION = "0.1.0";

export const DEFAULT_DUTIES = [
  "dependency-warden",
  "merge-concierge",
  "docs-warden",
  "flaky-test-warden",
] as const;

export interface StewardProjectConfig {
  version: 1;
  subject: { type: "github.repository"; id: string };
  duties: string[];
}

export function projectConfig(
  fullName: string,
  duties: string[] = [...DEFAULT_DUTIES],
): StewardProjectConfig {
  return {
    version: 1,
    subject: { type: "github.repository", id: fullName },
    duties,
  };
}
