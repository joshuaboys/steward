/**
 * Cloudflare Durable Object adapter.
 *
 * The domain steward does not depend on this file. This class is the
 * substrate mapping:
 *
 *   steward identity  →  Durable Object
 *   structured state  →  DO SQLite (via repositories, not this file)
 *   immediate wake    →  DO execution
 *
 * Workflows remain a separate binding. Do not put durable multi-step
 * waits in this object.
 */
import { RepoSteward } from "../steward.ts";
import type { StewardEvent } from "../types.ts";
import { SCHEMA_STATEMENTS } from "../storage/schema.ts";

export interface SqlExec {
  exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): {
    toArray(): T[];
    one(): T;
  };
}

export function applySchema(sql: SqlExec) {
  for (const statement of SCHEMA_STATEMENTS) {
    sql.exec(statement);
  }
}

export interface StewardEnv {
  STEWARDS: {
    idFromName(name: string): unknown;
    get(id: unknown): { receiveEvent(event: unknown): Promise<unknown> };
  };
  STEWARD_RUN_WORKFLOW: {
    create(options: { id: string; params: unknown }): Promise<{ id: string }>;
    get(id: string): Promise<{ sendEvent(event: { type: string; payload: unknown }): Promise<void> }>;
  };
}

/**
 * Structural Durable Object shape. The real Cloudflare class should
 * extend DurableObject<StewardEnv> and delegate to RepoSteward.
 */
export class RepoStewardBinding {
  private readonly steward: RepoSteward;
  constructor(steward: RepoSteward) {
    this.steward = steward;
  }

  async receiveEvent(event: StewardEvent) {
    return this.steward.receiveEvent(event);
  }
}
