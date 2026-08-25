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

**Status:** v0.1 — global CLI, in-process proofs, Cloudflare Worker substrate.

## Install

**Node 22.12 or later.** The CLI has no npm dependencies.

```sh
npm install -g github:joshuaboys/steward
```

That puts `steward` on your PATH. It stays available in every terminal. A
project is bound afterwards, not at install time.

```sh
cd your-repo
steward init              # git origin, or: steward init owner/repo
steward status
```

`init` writes `.steward/config.json` in that repository. The global binary
addresses that identity while you are in the tree. Different repos, same CLI.

From source, without a global install:

```sh
git clone https://github.com/joshuaboys/steward.git
cd steward
./bin/steward.mjs help
npm test
```

## Commands

| | |
| --- | --- |
| `steward init [owner/repo]` | Bind this directory to a RepoSteward |
| `steward use owner/repo` | Address a different known steward |
| `steward status` | Identity, duties, last activity |
| `steward list` | Every steward this process knows |
| `steward duties` | Standing applications on the current subject |
| `steward proof [name]` | Fire an architecture proof |
| `steward approve <id>` | Grant a pending approval |
| `steward reject <id>` | Reject a pending approval |
| `steward worker` | Local Worker (`wrangler dev`) |
| `steward deploy` | Deploy the Worker |
| `steward help` | Command list |

```sh
npm run setup            # Node version check; copy .dev.vars.example
npm test                 # in-process proofs (no Cloudflare account)
npm run worker           # local Worker + Durable Object
```

## Taxonomy

These are **not** four stewards.

| | |
| --- | --- |
| **Steward** | Durable identity for one subject. One GitHub repo → one `RepoSteward`. |
| **Duty** | A standing application on that steward. |
| **Run** | One bounded episode of work. The steward outlives it. |

```
RepoSteward  (owner/repo)
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

```sh
steward proof
steward proof docs-drift
```

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
bin/steward.mjs         global CLI entry
src/steward/cli         command loop
apps/ingress-worker     edge Worker (verify → normalise → route)
src/steward             domain runtime
wrangler.jsonc          SQLite DO + Workflow + R2
docs/cloudflare-runtime.md
```

## Spec

Cloudflare substrate: [docs/cloudflare-runtime.md](docs/cloudflare-runtime.md)
