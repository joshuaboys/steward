#!/usr/bin/env node
import { StewardRuntime } from "../src/steward/runtime.ts";
import { runProof } from "../src/steward/proofs.ts";

const proofs = [
  ["manifest-change", "Dependency Warden"],
  ["docs-drift", "Docs Warden"],
  ["ci-failed", "Flaky Test Warden"],
  ["merge-concierge", "Merge Concierge (waits)"],
];

const runtime = new StewardRuntime();

console.log("steward proofs  (in-process, no Cloudflare)\n");

for (const [id, label] of proofs) {
  const result = await runProof(runtime, id);
  const receipt = result.receipt;
  const line = [
    result.ok ? "ok" : "fail",
    receipt?.disposition ?? result.error ?? "?",
    receipt?.runId ?? "no-run",
  ].join("  ");
  console.log(`${label.padEnd(28)} ${line}`);
}

const snap = runtime.getSnapshot();
console.log("");
console.log(`stewards ${snap.order.length}  waiting ${snap.waiting}  running ${snap.running}`);
