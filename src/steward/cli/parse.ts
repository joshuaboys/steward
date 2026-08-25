export function tokenize(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed))) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  if (tokens[0] === "steward") tokens.shift();
  return tokens;
}

export function parseGithubRemote(url: string): string | undefined {
  const trimmed = url.trim().replace(/\.git$/i, "");
  const ssh = trimmed.match(/github\.com[:/]([^/\s]+)\/([^/\s]+)$/i);
  if (ssh) return `${ssh[1]}/${ssh[2]}`;
  const direct = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (direct) return `${direct[1]}/${direct[2]}`;
  return undefined;
}

export function isRepoId(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}
