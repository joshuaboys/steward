/**
 * Ingress Worker — public edge boundary.
 *
 * authenticate → validate → normalise → locate steward DO → deliver → respond
 *
 * This file is the Cloudflare fetch handler. The console uses the same
 * ingestGithubWebhook path in-process.
 */
import { ingestGithubWebhook } from "../../src/steward/events/ingress.ts";
import { locateSteward } from "../../src/steward/events/router.ts";
import { normaliseManualEvent } from "../../src/steward/events/normalise.ts";
import type { StewardEvent } from "../../src/steward/types.ts";

export interface IngressEnv {
  STEWARDS: {
    idFromName(name: string): unknown;
    get(id: unknown): {
      receiveEvent(event: StewardEvent): Promise<unknown>;
    };
  };
  GITHUB_WEBHOOK_SECRET: string;
}

export default {
  async fetch(request: Request, env: IngressEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, product: "steward" });
    }

    if (request.method === "POST" && url.pathname === "/webhooks/github") {
      const rawBody = await request.text();
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        return Response.json({ error: "invalid json" }, { status: 400 });
      }
      const result = await ingestGithubWebhook({
        contentType: request.headers.get("content-type"),
        rawBody,
        secret: env.GITHUB_WEBHOOK_SECRET,
        envelope: {
          headers: {
            event: request.headers.get("x-github-event") ?? "",
            deliveryId: request.headers.get("x-github-delivery") ?? "",
            signature: request.headers.get("x-hub-signature-256"),
          },
          body,
        },
        deliver: async (stewardId, event) => {
          const stub = env.STEWARDS.get(env.STEWARDS.idFromName(stewardId));
          return stub.receiveEvent(event) as Promise<never>;
        },
      });
      return Response.json(result, { status: result.status });
    }

    if (request.method === "POST" && url.pathname === "/runs") {
      const body = (await request.json()) as {
        subjectId: string;
        type?: string;
        payload?: unknown;
      };
      const event = normaliseManualEvent({
        type: body.type ?? "manual.run_requested",
        subjectId: body.subjectId,
        payload: body.payload,
      });
      const stewardId = locateSteward(event);
      const stub = env.STEWARDS.get(env.STEWARDS.idFromName(stewardId));
      const receipt = await stub.receiveEvent(event);
      return Response.json(receipt, { status: 202 });
    }

    return new Response("not found", { status: 404 });
  },
};
