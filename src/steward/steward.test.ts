import assert from "node:assert/strict";
import { test } from "node:test";
import { StewardRuntime } from "./runtime.ts";
import { runProof } from "./proofs.ts";
import { DEMO_WEBHOOK_SECRET, signGithubWebhook, verifyGithubSignature } from "./events/verify.ts";
import { normaliseGithubWebhook } from "./events/normalise.ts";
import { toTransportEventType } from "./events/names.ts";
import { locateSteward } from "./events/router.ts";
import { durableObjectName, subjectFromGithubRepository } from "./identity.ts";
import { evaluateAuthority } from "./policy/authority.ts";
import { canAfford } from "./policy/budget.ts";
import { DEFAULT_BUDGET, EMPTY_USAGE } from "./types.ts";

test("durable object name is deterministic", () => {
  const a = durableObjectName(subjectFromGithubRepository("eddacraft/anvil-001"));
  const b = durableObjectName(subjectFromGithubRepository("eddacraft/anvil-001"));
  assert.equal(a, "github:eddacraft/anvil-001");
  assert.equal(a, b);
});

test("workflow transport mapping strips dots", () => {
  assert.equal(toTransportEventType("github.workflow.completed"), "github_workflow_completed");
  assert.equal(toTransportEventType("approval.granted"), "approval_granted");
});

test("github signature verification", async () => {
  const body = JSON.stringify({ ok: true });
  const signature = await signGithubWebhook(DEMO_WEBHOOK_SECRET, body);
  assert.equal(
    await verifyGithubSignature({
      secret: DEMO_WEBHOOK_SECRET,
      body,
      signatureHeader: signature,
    }),
    true,
  );
  assert.equal(
    await verifyGithubSignature({
      secret: DEMO_WEBHOOK_SECRET,
      body,
      signatureHeader: "sha256=deadbeef",
    }),
    false,
  );
});

test("normalise github pull request webhook", () => {
  const event = normaliseGithubWebhook({
    headers: { event: "pull_request", deliveryId: "d1" },
    body: {
      action: "synchronize",
      repository: { full_name: "joshuaboys/occam" },
      pull_request: { number: 7, updated_at: "2026-08-25T03:00:00+08:00", head: { sha: "abc" } },
    },
  });
  assert.equal(event.id, "github-delivery-d1");
  assert.equal(event.type, "github.pull_request.synchronize");
  assert.equal(event.subject.id, "joshuaboys/occam");
  assert.equal(locateSteward(event), "github:joshuaboys/occam");
});

test("authority denies observe mutations and gates merge", () => {
  const merge = {
    id: "m",
    capability: "github.pull_request.merge",
    input: {},
    preconditions: { expectedHeadSha: "abc" },
    summary: "merge",
  };
  const denied = evaluateAuthority({
    capability: merge.capability,
    autonomy: "observe",
    action: merge,
  });
  assert.equal(denied.allow, false);
  const gated = evaluateAuthority({
    capability: merge.capability,
    autonomy: "supervised",
    action: merge,
  });
  assert.equal(gated.allow, true);
  assert.equal(gated.requireApproval, true);
  const rerun = evaluateAuthority({
    capability: "github.workflow.rerun",
    autonomy: "supervised",
    action: {
      id: "r",
      capability: "github.workflow.rerun",
      input: {},
      preconditions: { expectedHeadSha: "abc" },
      summary: "rerun",
    },
  });
  assert.equal(rerun.allow, true);
  assert.equal(rerun.requireApproval, false);
});

test("budget gate", () => {
  assert.equal(canAfford(DEFAULT_BUDGET, EMPTY_USAGE, { modelCalls: 1 }), true);
  assert.equal(
    canAfford(DEFAULT_BUDGET, { ...EMPTY_USAGE, modelCalls: 8 }, { modelCalls: 1 }),
    false,
  );
});

test("proof: dependency manifest change creates a durable run that completes without mutation", async () => {
  const runtime = new StewardRuntime();
  const result = await runProof(runtime, "manifest-change");
  assert.equal(result.ok, true);
  assert.equal(result.receipt?.duplicate, false);
  assert.ok(result.receipt?.runId);
  const view = runtime.getSnapshot().stewards["github:eddacraft/anvil-001"];
  const run = view.runs[0];
  assert.equal(run.applicationId, "dependency-warden");
  assert.equal(run.status, "completed");
  assert.equal(run.disposition, "observed");
  assert.equal(view.beliefs.some((row) => row.key === "dependency.serde.impact"), true);
  assert.equal(view.capabilityCalls.some((row) => row.capability === "model.classify"), true);
  assert.equal(view.capabilityCalls.some((row) => row.capability === "github.pull_request.merge"), false);
});

test("proof: duplicate github delivery does not create a second run", async () => {
  const runtime = new StewardRuntime();
  const first = await runProof(runtime, "manifest-change");
  const second = await runProof(runtime, "duplicate-webhook");
  assert.equal(second.ok, true);
  assert.equal(second.receipt?.duplicate, true);
  assert.equal(second.receipt?.disposition, "duplicate");
  const view = runtime.getSnapshot().stewards["github:eddacraft/anvil-001"];
  const wardenRuns = view.runs.filter((row) => row.applicationId === "dependency-warden");
  assert.equal(wardenRuns.length, 1);
  assert.equal(first.receipt?.runId, wardenRuns[0].id);
});

test("proof: merge concierge waits for CI with zero running compute, then resumes", async () => {
  const runtime = new StewardRuntime();
  const start = await runProof(runtime, "merge-concierge");
  assert.equal(start.ok, true);
  const waiting = runtime.getSnapshot();
  const steward = waiting.stewards["github:eddacraft/anvil-001"];
  const run = steward.runs[0];
  assert.equal(run.applicationId, "merge-concierge");
  assert.equal(run.status, "waiting");
  assert.ok(run.waitingFor);
  assert.equal(waiting.running, 0);
  assert.equal(waiting.waiting, 1);
  assert.equal(steward.waits.some((row) => row.eventType === "github.workflow.completed"), true);

  const resumed = await runProof(runtime, "ci-completed");
  assert.equal(resumed.ok, true);
  const after = runtime.getSnapshot().stewards["github:eddacraft/anvil-001"];
  const concierge = after.runs.find((row) => row.applicationId === "merge-concierge");
  assert.ok(concierge);
  assert.equal(concierge.status, "waiting");
  assert.ok(after.approvals.some((row) => row.status === "pending"));
  assert.equal(
    after.capabilityCalls.some((row) => row.capability === "github.review.request" && row.status === "ok"),
    true,
  );
  const pr = after.repository?.pullRequests.find((item) => item.number === 42);
  assert.ok(pr);
  assert.equal(pr.requestedReviewers.includes("maintainer"), true);
  assert.equal(pr.state, "open");
});

test("one event can update facts and resume a waiting workflow", async () => {
  const runtime = new StewardRuntime();
  await runProof(runtime, "merge-concierge");
  await runProof(runtime, "ci-completed");
  const view = runtime.getSnapshot().stewards["github:eddacraft/anvil-001"];
  assert.equal(view.facts.some((row) => row.key.startsWith("ci.")), true);
  assert.equal(view.logs.some((row) => row.event === "workflow_resumed"), true);
  assert.equal(view.approvals.length > 0, true);
});

test("approval then merge is idempotent on stale SHA rejection", async () => {
  const runtime = new StewardRuntime();
  await runProof(runtime, "merge-concierge");
  await runProof(runtime, "ci-completed");
  const view = runtime.getSnapshot().stewards["github:eddacraft/anvil-001"];
  const approval = view.approvals[0];
  assert.ok(approval);
  await runtime.resolveApproval("github:eddacraft/anvil-001", approval.id, "granted", "josh");
  const after = runtime.getSnapshot().stewards["github:eddacraft/anvil-001"];
  const pr = after.repository?.pullRequests.find((item) => item.number === 42);
  assert.equal(pr?.state, "merged");
  const concierge = after.runs.find((row) => row.applicationId === "merge-concierge");
  assert.equal(concierge?.status, "completed");
  assert.equal(concierge?.disposition, "merged");
});

test("proof: docs warden maps a public API change to the relevant page and records drift without mutating", async () => {
  const runtime = new StewardRuntime();
  const result = await runProof(runtime, "docs-drift");
  assert.equal(result.ok, true);
  assert.ok(result.receipt?.runId);
  const view = runtime.getSnapshot().stewards["github:eddacraft/anvil-001"];
  const run = view.runs.find((row) => row.applicationId === "docs-warden");
  assert.ok(run);
  assert.equal(run.status, "completed");
  assert.equal(run.disposition, "finding");
  assert.equal(view.beliefs.some((row) => row.key === "docs.drift.src/bootstrap.rs"), true);
  const belief = view.beliefs.find((row) => row.key === "docs.drift.src/bootstrap.rs");
  assert.equal((belief?.value as { drift?: boolean }).drift, true);
  assert.equal(view.capabilityCalls.some((row) => row.capability === "model.classify"), true);
  assert.equal(view.capabilityCalls.some((row) => row.capability === "github.file.read"), true);
  assert.equal(view.capabilityCalls.some((row) => row.capability === "github.pull_request.create"), false);
  assert.equal(view.capabilityCalls.some((row) => row.capability === "github.pull_request.merge"), false);
});

test("proof: unmapped code change is ignored without a model call", async () => {
  const runtime = new StewardRuntime();
  const result = await runProof(runtime, "docs-unmapped");
  assert.equal(result.ok, true);
  assert.equal(result.receipt?.disposition, "ignored");
  const view = runtime.getSnapshot().stewards["github:eddacraft/anvil-001"];
  assert.equal(view.runs.some((row) => row.applicationId === "docs-warden"), false);
  assert.equal(view.capabilityCalls.some((row) => row.capability === "model.classify"), false);
  assert.equal(view.logs.some((row) => row.event === "event_ignored"), true);
});

test("proof: flaky test warden classifies a timeout as a suspected flake and reruns CI", async () => {
  const runtime = new StewardRuntime();
  const result = await runProof(runtime, "ci-failed");
  assert.equal(result.ok, true);
  assert.ok(result.receipt?.runId);
  const view = runtime.getSnapshot().stewards["github:eddacraft/anvil-001"];
  const run = view.runs.find((row) => row.applicationId === "flaky-test-warden");
  assert.ok(run);
  assert.equal(run.status, "completed");
  assert.equal(run.disposition, "suspected_flake");
  const belief = view.beliefs.find((row) => row.key === "ci.flake.flake00dead");
  assert.equal((belief?.value as { outcome?: string }).outcome, "suspected_flake");
  assert.equal(
    view.capabilityCalls.some((row) => row.capability === "github.workflow.rerun" && row.status === "ok"),
    true,
  );
  const ci = view.repository?.workflowRuns.find((item) => item.headSha === "flake00dead");
  assert.ok(ci);
  assert.equal(ci.reruns >= 1, true);
  assert.equal(view.capabilityCalls.some((row) => row.capability === "github.pull_request.merge"), false);
});

test("CI success does not create a flaky-test-warden run", async () => {
  const runtime = new StewardRuntime();
  const result = await runProof(runtime, "ci-completed");
  assert.equal(result.ok, true);
  const view = runtime.getSnapshot().stewards["github:eddacraft/anvil-001"];
  assert.equal(view.runs.some((row) => row.applicationId === "flaky-test-warden"), false);
});

test("invalid signature is rejected before a run exists", async () => {
  const runtime = new StewardRuntime();
  const body = JSON.stringify({
    repository: { full_name: "eddacraft/anvil-001" },
    commits: [],
  });
  const result = await runtime.ingestSignedGithub(
    {
      headers: {
        event: "push",
        deliveryId: "bad",
        signature: "sha256=00",
      },
      body: JSON.parse(body) as Record<string, unknown>,
    },
    body,
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  const view = runtime.getSnapshot().stewards["github:eddacraft/anvil-001"];
  assert.equal(view.events.length, 0);
});
