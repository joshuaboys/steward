export const DEMO_WEBHOOK_SECRET = "steward-dev-webhook-secret";

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return hex(signature);
}

export async function signGithubWebhook(secret: string, body: string): Promise<string> {
  const digest = await hmacSha256Hex(secret, body);
  return `sha256=${digest}`;
}

export async function verifyGithubSignature(input: {
  secret: string;
  body: string;
  signatureHeader: string | null;
}): Promise<boolean> {
  const { secret, body, signatureHeader } = input;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }
  const expected = await signGithubWebhook(secret, body);
  if (expected.length !== signatureHeader.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return mismatch === 0;
}
