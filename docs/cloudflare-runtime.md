steward Cloudflare Runtime Specification

Field| Value
Status| Draft
Date| 25 August 2026
Product| steward
Runtime target| Cloudflare Workers
Persistent identity| Durable Objects
Durable execution| Cloudflare Workflows
Primary language| TypeScript

1. Purpose

This document defines the Cloudflare implementation substrate for steward.

It does not define steward's full product model. It defines how steward's core concepts are realised using Cloudflare primitives.

The key mapping is:

steward concept              Cloudflare implementation

Steward identity      →      Durable Object
Structured state      →      DO SQLite
Immediate wake/run    →      Durable Object execution
Long-running run      →      Workflow
External wait         →      Workflow waitForEvent
Scheduled wake        →      Agent schedule / DO alarm
HTTP/webhook ingress  →      Worker
Large artefacts       →      R2 where required

The architecture MUST preserve the distinction between:

«The steward owns durable responsibility and state. Workflows own durable execution.»

Cloudflare Durable Objects provide stateful, uniquely addressable objects with embedded SQLite, and Cloudflare explicitly recommends SQLite-backed Durable Objects for new implementations.

Cloudflare Workflows provide durable multi-step execution, retries, recovery and the ability to wait for external events. Cloudflare's current guidance specifically positions Agents/Durable Objects for state and identity, and Workflows for longer-running or multi-step work.

---

2. Architectural principles

2.1 One Durable Object per steward subject

For the initial RepoSteward implementation:

one GitHub repository
        =
one RepoSteward Durable Object

Examples:

github:eddacraft/anvil-001
github:joshuaboys/occam
github:joshuaboys/forge

The Durable Object name MUST be derived deterministically from the steward subject identity.

For example:

const id = env.STEWARDS.idFromName(
  `github:${owner}/${repository}`
);

The same subject MUST always resolve to the same Durable Object.

---

3. Top-level architecture

                       External systems

       GitHub       package registries      humans
         │                 │                  │
         └────────────┬────┴─────────────┬────┘
                      │                  │
                      ▼                  ▼
              ┌──────────────────────────────┐
              │      Ingress Worker          │
              │                              │
              │ authentication               │
              │ signature verification       │
              │ normalisation                │
              │ routing                      │
              └──────────────┬───────────────┘
                             │
                             ▼
                 ┌─────────────────────┐
                 │ Steward Durable     │
                 │ Object              │
                 │                     │
                 │ identity            │
                 │ state               │
                 │ intents             │
                 │ subscriptions       │
                 │ event dedupe        │
                 │ run coordination    │
                 └──────────┬──────────┘
                            │
                  ┌─────────┴─────────┐
                  │                   │
                  ▼                   ▼
            short execution      durable execution
                  │                   │
                  │                   ▼
                  │          ┌─────────────────┐
                  │          │ Cloudflare      │
                  │          │ Workflow        │
                  │          │                 │
                  │          │ retry           │
                  │          │ wait            │
                  │          │ resume          │
                  │          │ approval        │
                  │          └────────┬────────┘
                  │                   │
                  └─────────┬─────────┘
                            ▼
                     Capability Layer
                            │
          ┌─────────────────┼────────────────┐
          ▼                 ▼                ▼
       GitHub           OpenRouter        registries

---

4. Component inventory

The initial Cloudflare deployment SHOULD contain:

apps/
  ingress-worker

src/
  steward/
    steward.ts

  workflows/
    steward-run.ts

  events/
    ingress.ts
    normalise.ts
    verify.ts
    router.ts

  capabilities/
    github/
    models/
    registry/

  storage/
    schema.ts
    repositories.ts

  policy/
    authority.ts
    budget.ts
    approvals.ts

Cloudflare resources:

Workers application
Durable Object namespace
Workflow binding
R2 bucket                    optional initially
Secrets
Observability

D1 SHOULD NOT be required for initial steward-local state.

The Durable Object's embedded SQLite database should remain the authoritative state store for each steward unless a genuinely global query requirement emerges.

---

5. Ingress Worker

The ingress Worker is the public edge boundary.

It is responsible for receiving:

- GitHub webhooks;
- registry callbacks where available;
- manual execution requests;
- approval actions;
- administrative API requests;
- scheduled/watcher callbacks where required.

It MUST NOT contain steward reasoning.

Its responsibilities are:

authenticate
    ↓
validate
    ↓
normalise
    ↓
locate Steward DO
    ↓
deliver event
    ↓
respond

---

6. GitHub webhook ingress

Endpoint:

POST /webhooks/github

Flow:

request
   ↓
validate content type
   ↓
read delivery ID
   ↓
verify GitHub signature
   ↓
identify repository
   ↓
normalise event
   ↓
route to RepoSteward DO
   ↓
acknowledge

The GitHub delivery identifier SHOULD become the primary source event ID.

Example normalised envelope:

interface StewardEvent<T = unknown> {
  id: string;
  source: string;
  type: string;

  subject: {
    type: string;
    id: string;
  };

  occurredAt: string;
  receivedAt: string;

  correlationId?: string;
  causationId?: string;

  payload: T;
}

Example:

{
  "id": "github-delivery-123",
  "source": "github",
  "type": "pull_request.synchronize",
  "subject": {
    "type": "github.repository",
    "id": "eddacraft/anvil-001"
  },
  "occurredAt": "2026-08-25T03:00:00+08:00",
  "receivedAt": "2026-08-25T03:00:01+08:00"
}

---

7. Event naming

steward SHOULD use domain-oriented event names internally.

Examples:

github.push
github.pull_request.opened
github.pull_request.synchronize
github.pull_request.review_submitted
github.workflow.completed

dependency.release
dependency.security_advisory

schedule.tick

approval.granted
approval.rejected

manual.run_requested

Cloudflare Workflow event types have an important restriction: "waitForEvent" type names currently permit letters, numbers, "_" and "-", but not ".".

Therefore, the workflow transport mapping SHOULD convert:

github.workflow.completed

into:

github_workflow_completed

or another deterministic transport-safe representation.

The steward domain event name SHOULD remain unchanged internally.

---

8. RepoSteward Durable Object

The Durable Object owns the steward.

Conceptually:

export class RepoSteward extends Agent<Env, StewardState> {
  // steward lifecycle
}

Cloudflare's current Agents SDK "Agent" class itself runs on Durable Objects and provides server-side agent state and lifecycle primitives.

However, steward MUST NOT depend deeply on chat-specific Agents SDK concepts.

The Agent base class may be used as infrastructure while the steward domain remains independent.

---

9. Durable Object responsibilities

The DO MUST own:

- steward identity;
- subject metadata;
- current structured world state;
- standing intents;
- application registration;
- authority policy;
- budget policy;
- event deduplication;
- run records;
- workflow coordination;
- outstanding approvals;
- scheduled wakes;
- lightweight coordination locks.

The DO MUST NOT become:

- an endless model loop;
- a general workflow engine;
- a dumping ground for external artefacts;
- a shared global database;
- a long-running process manager.

---

10. SQLite schema

Each Durable Object receives its own embedded SQLite database.

Suggested initial schema:

CREATE TABLE steward (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE intents (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    autonomy TEXT NOT NULL,
    config_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE events (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    payload_json TEXT,
    disposition TEXT,
    run_id TEXT
);

CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    trigger_event_id TEXT,
    status TEXT NOT NULL,
    disposition TEXT,
    workflow_instance_id TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    budget_json TEXT,
    usage_json TEXT
);

CREATE TABLE facts (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    source_event_id TEXT,
    observed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE beliefs (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    confidence REAL NOT NULL,
    evidence_id TEXT,
    observed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE decisions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    type TEXT NOT NULL,
    decision_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE capability_calls (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    request_digest TEXT,
    response_digest TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    action_json TEXT NOT NULL,
    status TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by TEXT
);

This schema SHOULD remain intentionally boring.

Avoid generic event-sourcing machinery until there is evidence it is required.

---

11. Event deduplication

External systems frequently deliver events more than once.

The first operation performed when an event reaches a steward MUST be:

INSERT INTO events (...)
VALUES (...)
ON CONFLICT(id) DO NOTHING;

If no row is inserted:

duplicate
   ↓
return existing disposition
   ↓
no new run

No LLM call or external side-effect may happen before deduplication.

---

12. Event processing

Suggested DO RPC:

receiveEvent(event: StewardEvent): Promise<EventReceipt>

Flow:

receive event
    ↓
dedupe
    ↓
update obvious deterministic state
    ↓
match subscriptions / intents
    ↓
cheap relevance evaluation
    ↓
irrelevant?
 ┌────┴────┐
 yes       no
 │         │
record     create Run
 │         │
done       ▼

A deterministic event may be handled entirely inside the DO if processing is short and no durable wait is required.

---

13. Short execution vs Workflow

The runtime SHOULD deliberately choose between two paths.

Direct DO execution

Use for:

- event classification from cached state;
- simple deterministic state updates;
- very short external lookups;
- inexpensive bounded model calls;
- operations expected to complete comfortably within a normal request.

Workflow

Use for:

- multi-stage investigation;
- several external API calls;
- retries;
- slow model/tool work;
- waiting for CI;
- waiting for review;
- waiting for approval;
- actions expected to exceed roughly 30 seconds;
- anything where durable recovery materially matters.

Cloudflare currently recommends Agents alone for quick interaction, and Agent + Workflow for long-running work, multi-step pipelines and approval flows.

---

14. StewardRun Workflow

Generic workflow:

export class StewardRunWorkflow extends AgentWorkflow<
  Env,
  RunPayload
> {
  async run(event, step) {
    // ...
  }
}

The Workflow SHOULD not implement application-specific logic directly.

Instead:

StewardRunWorkflow
      │
      ▼
resolve application
      │
      ▼
execute application stages
      │
      ▼
capabilities

---

15. Workflow stages

A generic run MAY contain:

classify
investigate
decide
plan
policy-check
act
verify
record

Not every run needs every stage.

Each durable stage SHOULD use "step.do()" where replay/retry boundaries matter.

Conceptually:

const classification = await step.do(
  "classify-event",
  async () => classify(...)
);

External side-effects MUST be isolated into explicit workflow steps.

---

16. Workflow identity

Every steward Run SHOULD map to at most one primary Workflow instance.

Suggested mapping:

Run ID:
run_01J...

Workflow instance ID:
steward-run_run_01J...

The mapping MUST be persisted in the DO "runs" table.

This allows:

Steward
  ↓
Run
  ↓
Workflow instance

to be inspected deterministically.

---

17. Waiting for external events

One of the strongest reasons to use Workflows is eliminating polling.

Example merge concierge:

start Run
  ↓
rebase PR
  ↓
waitForEvent(ci_completed)
  ↓
check CI
  ↓
waitForEvent(review_submitted)
  ↓
evaluate review
  ↓
complete

Cloudflare Workflows can durably pause using "step.waitForEvent", and later resume when an event is sent to the workflow instance.

This SHOULD be steward's preferred implementation for external waiting.

---

18. Routing an incoming event to a waiting Workflow

When the RepoSteward receives an event:

event
  ↓
does this correlate with active run?
  ↓
yes
  ↓
find workflow instance
  ↓
sendEvent()

Example correlation:

workflow_run.completed
repository = eddacraft/anvil-001
head_sha = abc123

The DO queries:

active merge-concierge Run
waiting for CI on abc123

Then emits:

workflow event:
ci_completed

The Workflow wakes and continues.

The event SHOULD still be available to other intents/applications independently.

One external event MAY therefore:

- resume an existing Workflow;
- update steward state;
- create another Run.

These are separate concerns.

---

19. Scheduling

Scheduled responsibilities SHOULD belong to the steward rather than a central polling service where practical.

Examples:

check dependency registries every six hours
weekly repository health review
retry unresolved state tomorrow
wake when approval timeout expires

Cloudflare Agents support persisted scheduled tasks, while underlying Durable Object alarms provide the wake mechanism.

The first implementation SHOULD expose a steward-level abstraction:

interface StewardSchedule {
  id: string;
  type: "once" | "interval" | "cron";
  specification: string;
  eventType: string;
}

A schedule firing SHOULD generate a normal steward event:

schedule.tick

Applications MUST NOT depend directly on Cloudflare alarm APIs.

---

20. Watchers

Watchers convert polling-based sources into steward events.

Example:

schedule wakes steward
      ↓
watch crates.io package
      ↓
latest version changed?
      ↓
no → update observation and sleep
yes
      ↓
emit dependency.release event

Watcher state SHOULD be persisted in DO SQLite.

Example:

CREATE TABLE watchers (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    config_json TEXT NOT NULL,
    cursor_json TEXT,
    last_checked_at TEXT,
    next_check_at TEXT
);

---

21. Capability layer

Cloudflare infrastructure code MUST NOT directly implement application business decisions.

External systems are exposed through capability adapters.

Example:

interface Capability<I, O> {
  id: string;
  execute(input: I, context: CapabilityContext): Promise<O>;
}

Initial capabilities:

github.repository.read
github.file.read
github.diff.read
github.pull_request.read
github.pull_request.create
github.pull_request.comment
github.review.request
github.workflow.read
github.workflow.rerun

registry.release.read
registry.changelog.read

model.classify
model.reason

---

22. Model access

OpenRouter SHOULD initially be called directly from a model capability adapter.

Conceptually:

application
   ↓
model capability
   ↓
model policy
   ↓
OpenRouter adapter
   ↓
model/provider

The Durable Object itself SHOULD NOT know OpenRouter request formats.

Model responses SHOULD be normalised before returning to steward application logic.

---

23. Model execution location

Model calls MAY execute:

- directly inside the DO for short operations;
- inside a Workflow step for durable runs.

Preference:

cheap classification:
DO

significant analysis:
Workflow

The same model capability API SHOULD work in both environments.

---

24. Budgets

Budget state MUST remain steward-owned.

Example:

interface RunBudget {
  maxCostUsd: number;
  maxModelCalls: number;
  maxSteps: number;
  maxCapabilityCalls: number;
}

Usage MUST be persisted after meaningful model/tool execution.

The Workflow SHOULD query/update run usage through the originating steward.

No Workflow may silently exceed its Run budget.

---

25. Authority gate

External mutation MUST pass steward's policy engine immediately before invocation.

proposed action
     ↓
schema validation
     ↓
authority
     ↓
intent policy
     ↓
run budget
     ↓
approval requirement
     ↓
execute

This policy code SHOULD be plain TypeScript and deterministic.

The Cloudflare platform is execution infrastructure, not the source of authority.

---

26. Approval flow

Example:

Workflow proposes merge
      ↓
authority = approval required
      ↓
Steward creates approval
      ↓
Workflow waits
      ↓
human approves via API/UI
      ↓
Ingress Worker
      ↓
RepoSteward
      ↓
update approval
      ↓
send approval_granted to Workflow
      ↓
Workflow resumes
      ↓
revalidate current PR state
      ↓
merge

The approval event MUST NOT itself execute the mutation.

The Workflow MUST re-check preconditions after waking because external state may have changed while waiting.

---

27. Concurrency

Durable Objects provide a useful natural coordination boundary because all requests for a given steward identity route to the same object.

However, steward MUST still explicitly handle logical concurrency.

Example:

Run A analysing PR SHA abc
              │
new push → SHA def
              │
Run A proposes mutation
              ↓
precondition check:
expected SHA abc
actual SHA def
              ↓
superseded

Every mutation SHOULD include the strongest available external precondition.

Examples:

- expected Git commit SHA;
- expected PR head SHA;
- expected dependency version;
- expected workflow attempt.

---

28. Idempotency

Every externally mutating capability MUST have a steward action ID.

Suggested identity:

<steward-id>:<run-id>:<action-id>

Example:

github:eddacraft/anvil-001:
run_01J...:
request-review_01

Where external APIs lack idempotency keys, steward SHOULD persist action intent and reconcile external state before retrying.

---

29. Retry semantics

Workflows MAY automatically retry failed durable steps.

Therefore, steps containing external mutations MUST be idempotent.

Safe pattern:

step
  ↓
check whether desired outcome already exists
  ↓
if yes:
    return existing result
  ↓
otherwise:
    perform mutation
  ↓
persist resulting identifier

Never assume:

step.do()

implies external APIs are exactly-once.

---

30. R2

R2 SHOULD be optional in v0.1.

Use R2 when an artefact is:

- too large for sensible SQLite storage;
- useful outside a single row-level query;
- naturally blob-shaped;
- worth retaining as evidence.

Potential examples:

large Git diffs
CI logs
downloaded changelogs
model raw traces
generated patch bundles
evidence archives

SQLite SHOULD retain metadata and a reference:

r2://steward-evidence/<steward>/<run>/<artifact>

Do not move ordinary structured steward state into R2.

---

31. D1

D1 SHOULD NOT be included in initial architecture.

A global database becomes useful only if steward requires queries such as:

show every unhealthy repository across an organisation

The initial design can derive this through a separate index/reporting layer later.

Per-steward truth remains in Durable Objects.

Do not prematurely duplicate all DO state into D1.

---

32. Queues

Cloudflare Queues are NOT required for v0.1.

Durable Objects + Workflows already provide:

- subject routing;
- coordination;
- persistence;
- retries;
- waiting.

Queues MAY become appropriate for high-volume fan-out where one external event intentionally generates large numbers of independent tasks.

Example future use:

security advisory
      ↓
affects 28,000 repos
      ↓
Queue
      ↓
fan-out to RepoStewards

Do not add Queues before this scale exists.

---

33. Service bindings

Internal Cloudflare components SHOULD prefer service/RPC bindings over public HTTP when practical.

For example:

Ingress Worker
    ↓ RPC
RepoSteward DO

External HTTP should exist only where required.

This reduces unnecessary public attack surface and keeps internal contracts explicit.

---

34. Secrets

Secrets MAY include:

GitHub App private key
GitHub webhook secret
OpenRouter credentials
service credentials

Secrets MUST NOT be persisted into steward SQLite.

Durable state SHOULD reference credential identities rather than credentials themselves.

Applications MUST never receive arbitrary access to the full environment binding object.

Capabilities should receive only the credentials required for their operation.

---

35. Tenant model

Initial identity:

GitHub installation
    ↓
repository
    ↓
RepoSteward

The subject identity MUST contain enough information to prevent repository-name collisions.

Prefer immutable GitHub IDs internally where practical.

Human-facing identity may remain:

owner/repository

---

36. Deletion

Deleting a steward MUST be explicit.

Suggested process:

mark steward deleting
     ↓
cancel/supersede active Runs
     ↓
cancel Workflow instances where supported
     ↓
remove schedules
     ↓
remove retained R2 artefacts according to policy
     ↓
delete DO state

Repository deletion or GitHub App uninstallation SHOULD trigger this lifecycle.

---

37. Hibernation and cost model

The architecture assumes that steward instances spend most of their lifetime idle.

Durable Objects are billed for active compute duration, while objects that are idle and eligible for hibernation do not incur compute duration charges during that idle period. Persistent SQLite storage is billed separately.

Therefore:

persistent responsibility
       ≠
persistent compute

This is a fundamental economic property of steward.

The implementation MUST avoid patterns that prevent hibernation unnecessarily.

In particular:

- no permanent timers;
- no needless open connections;
- no busy polling;
- no in-memory background loops.

Use alarms/schedules, events and Workflows instead.

---

38. Observability

Every request/run SHOULD carry:

steward_id
run_id
event_id
workflow_instance_id
application_id

where applicable.

Structured logs SHOULD include:

event_received
event_deduplicated
event_ignored
run_created
workflow_started
workflow_waiting
workflow_resumed
capability_called
action_denied
approval_requested
run_completed
run_failed

Avoid writing complete model prompts or secrets into default logs.

---

39. Evidence

Cloudflare runtime events are only one part of steward evidence.

The evidence layer SHOULD record:

trigger
observations
model calls
capability calls
policy decisions
approvals
mutations
verification
outcome
cost
duration

The DO SQLite database SHOULD hold the evidence index.

Large evidence artefacts MAY be stored in R2.

---

40. Deployment configuration

Conceptual "wrangler" resources:

{
  "durable_objects": {
    "bindings": [
      {
        "name": "STEWARDS",
        "class_name": "RepoSteward"
      }
    ]
  },

  "workflows": [
    {
      "name": "steward-run",
      "binding": "STEWARD_RUN_WORKFLOW",
      "class_name": "StewardRunWorkflow"
    }
  ],

  "r2_buckets": [
    {
      "binding": "EVIDENCE",
      "bucket_name": "steward-evidence"
    }
  ]
}

Exact configuration MUST follow the Cloudflare platform syntax at implementation time.

SQLite-backed Durable Objects MUST be declared through the appropriate Durable Object migration/configuration mechanism.

---

41. Environment separation

Use independent Cloudflare resources for:

local
development
production

At minimum:

steward-dev
steward-prod

DO namespaces and Workflow environments MUST NOT be unintentionally shared across development and production.

GitHub webhook installations SHOULD similarly be separable where possible.

---

42. Local development

The project SHOULD support:

npm run dev

or equivalent Wrangler-based local execution.

Testing SHOULD include Cloudflare's Workers test tooling.

At least the following should be testable without real GitHub mutations:

webhook verification
event normalisation
DO routing
dedupe
SQLite state changes
intent matching
run creation
policy gates
budget enforcement
workflow transitions
workflow event resumption
idempotency

---

43. Application interface

The Cloudflare substrate SHOULD expose applications to the steward runtime through a minimal interface.

interface StewardApplication {
  id: string;

  subscriptions: EventMatcher[];

  consider(
    context: StewardContext,
    event: StewardEvent
  ): Promise<Consideration>;

  run(
    context: RunContext
  ): Promise<RunResult>;
}

The application MUST NOT know whether it is executing:

inside DO
or
inside Workflow

unless it explicitly requires durable workflow semantics.

---

44. Durable execution hint

Applications MAY indicate execution requirements:

type ExecutionClass =
  | "immediate"
  | "durable";

Example:

dependency release initial relevance:
immediate

dependency impact investigation:
durable

merge concierge waiting for CI:
durable

The runtime, not the application, SHOULD remain responsible for choosing the concrete Cloudflare mechanism.

---

45. MVP Cloudflare scope

v0.1 SHOULD implement only:

Cloudflare infrastructure

- Worker ingress;
- one SQLite-backed Durable Object namespace;
- RepoSteward;
- one generic StewardRun Workflow;
- schedule/alarm support;
- secrets;
- structured logging.

Event system

- GitHub webhook ingestion;
- signature validation;
- normalisation;
- routing;
- event deduplication;
- correlation.

Steward persistence

- steward identity;
- intents;
- events;
- runs;
- facts;
- decisions;
- approvals;
- usage/budgets.

Execution

- immediate Run path;
- Workflow Run path;
- Workflow wait/resume;
- capability invocation;
- authority gate;
- budget gate.

Initial external adapters

- GitHub;
- OpenRouter.

First use cases

- Dependency Warden;
- Merge Concierge.

---

46. Explicitly deferred

Do not include in v0.1:

D1
Queues
Vectorize
global semantic memory
multi-agent communication
WebSocket UI
chat interface
public marketplace
cross-steward delegation
cross-repository orchestration
complex organisation-wide indexing
automatic capability generation
forge integration
occam integration

Each MAY be evaluated later independently.

---

47. Implementation order

Recommended sequence:

1. Worker + RepoSteward DO
2. DO SQLite schema
3. GitHub webhook verification
4. event normalisation
5. event dedupe
6. run model
7. capability interface
8. deterministic policy gate
9. OpenRouter adapter
10. generic Workflow
11. Workflow resume from webhook
12. scheduling/watchers
13. approvals
14. evidence
15. dependency warden
16. merge concierge

Do not begin with a full dashboard or application catalogue.

---

48. Proof-of-architecture scenario

The first end-to-end Cloudflare proof SHOULD be:

GitHub webhook:
dependency manifest changed
        ↓
Ingress Worker verifies webhook
        ↓
routes to RepoSteward
        ↓
event stored/deduplicated
        ↓
Steward determines investigation required
        ↓
creates Run
        ↓
starts StewardRun Workflow
        ↓
Workflow reads dependency/repository state
        ↓
model classifies impact
        ↓
no mutation required
        ↓
Workflow records evidence
        ↓
Run completes
        ↓
Steward returns idle

The second proof SHOULD demonstrate durable waiting:

PR becomes ready
        ↓
merge-concierge Run
        ↓
Workflow waits for CI
        ↓

      zero active work

        ↓
GitHub CI webhook arrives
        ↓
RepoSteward receives event
        ↓
routes event to Workflow
        ↓
Workflow resumes
        ↓
checks policy
        ↓
requests review / completes

This second case is the strongest validation that Cloudflare is the correct runtime substrate.

---

49. Architectural acceptance criteria

The Cloudflare substrate is acceptable when:

- every steward subject resolves deterministically to one DO;
- idle stewards require no active process;
- duplicate GitHub webhooks cannot duplicate a Run or mutation;
- structured state survives DO eviction;
- long-running runs survive interruption;
- Workflows can pause without polling;
- external webhook events can resume the correct Workflow;
- one event can update steward state and resume an existing run independently;
- all external mutations pass deterministic authority checks;
- external mutations are idempotent or reconciled before retry;
- model budgets survive Workflow retries;
- stale actions are rejected before mutation;
- a steward can be inspected from persistent state without reconstructing conversation history;
- no application needs direct access to Cloudflare storage or bindings;
- no application needs to know about Durable Object implementation details;
- the system returns to zero active compute when nothing requires attention.

---

50. Core Cloudflare invariant

The implementation should preserve this boundary:

              Cloudflare Worker
                     │
                  ingress
                     │
                     ▼
              Durable Object
              ───────────────
              WHO / WHAT / STATE
                     │
                     │ creates
                     ▼
                  Workflow
              ───────────────
              DO / WAIT / RETRY
                     │
                     ▼
                Capabilities
              ───────────────
                   ACT

Or in one sentence:

«Durable Objects give a steward continuity; Workflows give its work continuity.»

Those are separate responsibilities and should remain separate in the implementation.