import { locateSteward } from "./router.ts";
import { normaliseGithubWebhook, type GithubWebhookEnvelope } from "./normalise.ts";
import { DEMO_WEBHOOK_SECRET, verifyGithubSignature } from "./verify.ts";
import type { EventReceipt, StewardEvent } from "../types.ts";

export interface IngressResult {
  ok: boolean;
  status: number;
  error?: string;
  stewardId?: string;
  event?: StewardEvent;
  receipt?: EventReceipt;
}

export async function ingestGithubWebhook(input: {
  contentType: string | null;
  envelope: GithubWebhookEnvelope;
  rawBody: string;
  secret?: string;
  deliver: (stewardId: string, event: StewardEvent) => Promise<EventReceipt>;
}): Promise<IngressResult> {
  if (!(input.contentType ?? "").includes("application/json")) {
    return { ok: false, status: 415, error: "content type must be application/json" };
  }
  const valid = await verifyGithubSignature({
    secret: input.secret ?? DEMO_WEBHOOK_SECRET,
    body: input.rawBody,
    signatureHeader: input.envelope.headers.signature ?? null,
  });
  if (!valid) {
    return { ok: false, status: 401, error: "invalid GitHub signature" };
  }
  let event: StewardEvent;
  try {
    event = normaliseGithubWebhook(input.envelope);
  } catch (error) {
    return {
      ok: false,
      status: 400,
      error: error instanceof Error ? error.message : "normalisation failed",
    };
  }
  const stewardId = locateSteward(event);
  const receipt = await input.deliver(stewardId, event);
  return { ok: true, status: 202, stewardId, event, receipt };
}
