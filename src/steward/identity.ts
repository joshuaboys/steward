import type { StewardSubject } from "./types.ts";

export function githubSubjectId(owner: string, repository: string): string {
  return `${owner}/${repository}`;
}

export function durableObjectName(subject: StewardSubject): string {
  if (subject.type === "github.repository") {
    return `github:${subject.id}`;
  }
  return `${subject.type}:${subject.id}`;
}

export function stewardIdFromName(name: string): string {
  return name;
}

export function parseGithubRepository(fullName: string): { owner: string; repository: string } {
  const [owner, repository] = fullName.split("/");
  if (!owner || !repository) {
    throw new Error(`Invalid GitHub repository identity: ${fullName}`);
  }
  return { owner, repository };
}

export function subjectFromGithubRepository(fullName: string): StewardSubject {
  return {
    type: "github.repository",
    id: fullName,
  };
}
