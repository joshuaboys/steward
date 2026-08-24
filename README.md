# steward

Durable Objects give a steward continuity. Workflows give its work continuity.

Cloudflare implementation substrate. The domain model is Cloudflare-independent;
the Worker / Durable Object / Workflow bindings are adapters.

Spec: [docs/cloudflare-runtime.md](docs/cloudflare-runtime.md)

## Mapping

| steward concept | Cloudflare implementation |
| --- | --- |
| Steward identity | Durable Object (`RepoSteward`) |
| Structured state | DO SQLite |
| Immediate wake/run | Durable Object execution |
| Long-running run | Workflow (`StewardRunWorkflow`) |
| External wait | `step.waitForEvent` |
| Scheduled wake | steward schedule / DO alarm |
| HTTP/webhook ingress | Worker |
| Large artefacts | R2 (optional in v0.1) |

D1 and Queues are intentionally absent.

## Proofs

1. **Dependency Warden** — signed `push` on `Cargo.toml` → investigate → classify impact → record evidence → no mutation.
2. **Merge Concierge** — PR ready → workflow waits for CI at zero compute → GitHub `workflow_run` resumes the instance → request review → merge only with approval.

Duplicate GitHub deliveries cannot create a second run.

## Layout

```
apps/ingress-worker     edge Worker (verify → normalise → route)
src/steward             domain runtime
wrangler.jsonc          SQLite Durable Object + Workflow + R2
docs/cloudflare-runtime.md
```

```sh
npm test
```
