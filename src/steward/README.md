# steward — Cloudflare runtime

Durable Objects give a steward continuity. Workflows give its work continuity.

This package is the Cloudflare implementation substrate for steward, as specified
in the 25 August 2026 runtime document.

| steward concept | Cloudflare implementation |
| --- | --- |
| Steward identity | Durable Object |
| Structured state | DO SQLite |
| Immediate wake/run | Durable Object execution |
| Long-running run | Workflow |
| External wait | Workflow `waitForEvent` |
| Scheduled wake | Agent schedule / DO alarm |
| HTTP/webhook ingress | Worker |
| Large artefacts | R2 where required |

## Layout

```
apps/ingress-worker     public edge boundary
src/steward             domain runtime (DO-shaped, Cloudflare-independent)
  steward.ts            RepoSteward
  workflows/            generic StewardRun + local replay engine
  events/               verify, normalise, route, ingest
  capabilities/         GitHub, registry, model
  policy/               authority, budget, approvals
  applications/         dependency-warden, merge-concierge
  storage/              schema + repositories
wrangler.jsonc          Worker, SQLite DO, Workflow, R2
```

The console in this workspace runs the same domain runtime in-process so the
two proof scenarios can be inspected without a Cloudflare account:

1. Dependency manifest changed → investigate → classify → no mutation.
2. Merge concierge waits for CI (`waitForEvent`) at zero compute, then resumes
   from the GitHub workflow webhook, requests review, and merge-gates on approval.

Applications never import Durable Object, Workflow, or SQLite APIs.
