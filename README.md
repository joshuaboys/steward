# steward

A steward holds responsibility even when it is not running.

It is not a chatbot, a cron job, or a long-lived agent session. It is a
persistent identity for one subject — today, a GitHub repository — with
standing duties, structured state, explicit authority, and bounded runs.

When the world changes it wakes, decides whether the change matters, does
only the work required, records evidence, and returns to idle.

```
standing responsibility + world change
        → consider → decide → maybe act → record → idle
```

## Install

**Node 22.12 or later.** The runtime has no npm dependencies.

```sh
git clone https://github.com/joshuaboys/steward.git
cd steward
npm test
```

`npm install` is optional. `npm test` runs the proofs in-process: no Cloudflare
account, no GitHub App, no secrets.

```sh
npm run setup     # checks Node, writes .dev.vars
npm run proof     # prints the four proof receipts
```

## Run

| Command | What it does |
| --- | --- |
| `npm test` | Runtime proofs (zero deps) |
| `npm run proof` | Same proofs, printed as a ledger |
| `npm run setup` | Node check + local Worker secrets |
| `npm run worker` | Ingress Worker + Durable Object locally (`npx wrangler`) |
| `npm run deploy` | Deploy the Worker |

The operations console is the same runtime in-process:

```sh
npm install
npm run dev
```

### Local Worker

```sh
npm run setup
npm run worker
```

```
GET  /health
POST /webhooks/github     signed GitHub deliveries
POST /runs                manual run
```

Copy `.dev.vars.example` to `.dev.vars` if you skipped setup. The demo webhook
secret is `steward-dev-webhook-secret`.

### Deploy

```sh
npx wrangler login
npx wrangler r2 bucket create steward-evidence
npx wrangler secret put GITHUB_WEBHOOK_SECRET
npm run deploy
```

Point a GitHub App or repository webhook at `https://<worker>/webhooks/github`
with content type `application/json` and the same signing secret.

## Taxonomy

These are **not** four stewards.

| | |
| --- | --- |
| **Steward** | Durable identity for one subject. One GitHub repo → one `RepoSteward`. |
| **Duty** | A standing application on that steward. |
| **Run** | One bounded episode of work. The steward outlives it. |

```
RepoSteward  (eddacraft/anvil-001)
├── Dependency Warden     observe
├── Merge Concierge       supervised
├── Docs Warden           observe
└── Flaky Test Warden     supervised
```

Models propose. Policy permits. Capabilities act.

## Proofs

1. **Dependency Warden** — signed `push` on `Cargo.toml` → classify impact → record evidence → no mutation.
2. **Merge Concierge** — PR ready → workflow waits for CI at zero compute → `workflow_run` resumes it → request review → merge only with approval.
3. **Docs Warden** — `src/bootstrap.rs` maps to `docs/bootstrap.md` only → classify drift → finding, no mutation. Unmapped files never reach a model.
4. **Flaky Test Warden** — CI `failure` with a timeout → `suspected_flake` → rerun. Green CI does not start this duty.

Duplicate GitHub deliveries cannot create a second run.

## Mapping

| steward | Cloudflare |
| --- | --- |
| Identity | Durable Object (`RepoSteward`) |
| Structured state | DO SQLite |
| Immediate wake | Durable Object execution |
| Long-running run | Workflow (`StewardRunWorkflow`) |
| External wait | `step.waitForEvent` |
| Scheduled wake | steward schedule / DO alarm |
| HTTP / webhook ingress | Worker |
| Large artefacts | R2 (optional in v0.1) |

D1 and Queues are intentionally absent.

The domain runtime in `src/steward` does not import Durable Object, Workflow,
or SQLite APIs. Applications do not grant themselves authority.

## Layout

```
apps/ingress-worker     edge Worker (verify → normalise → route)
src/steward             domain runtime
  applications/         duties
  capabilities/         GitHub, registry, models
  policy/               authority, budget, approvals
  workflows/            generic StewardRun + local replay
  storage/              schema + repositories
wrangler.jsonc          SQLite DO + Workflow + R2
docs/cloudflare-runtime.md
```

## Specs

- Product: attached steward product specification (25 August 2026)
- Substrate: [docs/cloudflare-runtime.md](docs/cloudflare-runtime.md)
