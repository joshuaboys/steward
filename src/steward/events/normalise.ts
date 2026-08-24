import { subjectFromGithubRepository } from "../identity.ts";
import { nowIso } from "../ids.ts";
import type { StewardEvent } from "../types.ts";

export interface GithubWebhookEnvelope {
  headers: {
    event: string;
    deliveryId: string;
    signature?: string | null;
  };
  body: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function repositoryFullName(body: Record<string, unknown>): string {
  const repo = asRecord(body.repository);
  const fullName = typeof repo?.full_name === "string" ? repo.full_name : undefined;
  if (fullName) return fullName;
  const owner = asRecord(repo?.owner);
  const name = typeof repo?.name === "string" ? repo.name : undefined;
  const login = typeof owner?.login === "string" ? owner.login : undefined;
  if (login && name) return `${login}/${name}`;
  throw new Error("GitHub webhook is missing repository identity");
}

function occurredAt(body: Record<string, unknown>): string {
  const candidates = [
    body.updated_at,
    asRecord(body.pull_request)?.updated_at,
    asRecord(body.head_commit)?.timestamp,
    asRecord(body.workflow_run)?.updated_at,
    asRecord(body.release)?.published_at,
  ];
  for (const value of candidates) {
    if (typeof value === "string") return new Date(value).toISOString();
  }
  return nowIso();
}

function githubDomainType(event: string, body: Record<string, unknown>): string {
  const action = typeof body.action === "string" ? body.action : undefined;
  if (event === "push") return "github.push";
  if (event === "pull_request" && action) return `github.pull_request.${action}`;
  if (event === "pull_request_review" && action) {
    return `github.pull_request.review_${action}`;
  }
  if (event === "workflow_run" && (action === "completed" || !action)) {
    return "github.workflow.completed";
  }
  if (event === "workflow_run" && action) return `github.workflow.${action}`;
  if (action) return `github.${event}.${action}`;
  return `github.${event}`;
}

export function normaliseGithubWebhook(envelope: GithubWebhookEnvelope): StewardEvent {
  const { headers, body } = envelope;
  const fullName = repositoryFullName(body);
  return {
    id: `github-delivery-${headers.deliveryId}`,
    source: "github",
    type: githubDomainType(headers.event, body),
    subject: subjectFromGithubRepository(fullName),
    occurredAt: occurredAt(body),
    receivedAt: nowIso(),
    payload: body,
  };
}

export function normaliseManualEvent(input: {
  id?: string;
  type: string;
  source?: string;
  subjectId: string;
  payload?: unknown;
}): StewardEvent {
  return {
    id: input.id ?? `manual-${crypto.randomUUID()}`,
    source: input.source ?? "manual",
    type: input.type,
    subject: subjectFromGithubRepository(input.subjectId),
    occurredAt: nowIso(),
    receivedAt: nowIso(),
    payload: input.payload ?? {},
  };
}
