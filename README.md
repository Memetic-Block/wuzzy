# Wuzzy

A search index for AI agents, where every result carries onchain proof of what was crawled
and when.

Wuzzy crawls web content, canonicalizes each page through a pinned public
procedure, and attests the resulting hash on Base. `/search` is keyless: payment is the only
gate, over x402. A paying agent gets results with a provenance block it can verify itself,
without trusting us.

- **Backend** — [apps/backend](apps/backend/): NestJS (TypeScript) on the Bun runtime, TypeORM
  against Postgres + pgvector. Pipeline stages are CLI commands, not queue workers.
- **Frontend** — [apps/frontend](apps/frontend/): HTMX pages written as JSX templates,
  pre-rendered to static HTML at build time by [build.ts](apps/frontend/build.ts), styled with
  Tailwind, served by nginx in production.
- **CI** — [.github/workflows/ci.yaml](.github/workflows/ci.yaml): installs, typechecks, runs
  the scenario suite against a pgvector service, and publishes both images to GHCR.

## How to verify what Wuzzy claims

[VERIFY.md](VERIFY.md) is the prose specification of the canonicalization procedure, and
[contracts/canonicalize-v1.feature](contracts/canonicalize-v1.feature) plus
[fixtures/canonicalize-v1/](fixtures/canonicalize-v1/) are the same thing in executable form.
They are published protocol artifacts: third parties build independent verifiers against
them. Only hashes and metadata go onchain, never content.

## Contracts are the definition of done

Gherkin feature files in [contracts/](contracts/) are the spec of record. A work item is done
when its scenarios pass in CI. Tests bind to a scenario by name through
`scenario()`, and the coverage spec fails the build if a scenario in an enforced feature has
no test, or if a test names a scenario that no feature file declares.

```sh
bun run scenarios   # coverage per feature file
```

Scenarios tagged `@mainnet @manual` are run by a human against Base mainnet. CI never runs
them, and a test claiming one of those names fails the build.

## Pipeline

Stages are CLI commands, not queue workers, so a run is something you start, watch, and can
re-run idempotently.

```sh
bun run wuzzy crawl                         # crawl seeds.json
bun run wuzzy crawl --per-host=250          # cap each host, for a sample
bun run wuzzy crawl https://docs.base.org   # or name hosts explicitly
bun run wuzzy embed                         # chunk and embed whatever is pending
bun run wuzzy attest                        # multiAttest anything without a UID
bun run wuzzy verify <url>                  # re-derive the hash for one indexed URL
```

`verify` exits 0 on a match, 1 on a mismatch, and 2 when the URL is not indexed, so it drops
straight into a script.

[seeds.json](seeds.json) is the curated seed list, kept as data so what the index is built
from is reviewable rather than remembered. Scope is the exact host of each entry, so a
subdomain needs its own line.

Two knobs matter on a multi-host crawl. `--per-host` caps each site rather than the run:
without it a site that lists thousands of URLs in a sitemap spends the whole budget before a
site with no sitemap has discovered its second page. And requests to any one host are spaced
by `minHostIntervalMs` (250ms by default) because concurrency is global, so a run over
several sites can otherwise put every worker on one of them.

Each stage is restartable because its work queue is a query rather than external state.
`embed` picks up documents with a null `embedded_at` and `attest` picks up those with a null
`attestation_uid`; the crawler nulls both columns again whenever content changes. So a re-run
over an unchanged corpus does nothing, a changed page is re-embedded and re-attested, and an
interrupted run resumes without anyone tracking what already happened.

`attest` needs a funded key, which is why it is the one stage a human runs by hand. It reads
`ATTESTER_PRIVATE_KEY` from the environment at call time and refuses to start without it. No
key belongs in this repo, in an agent session, or on a shared machine.

Only hashes and metadata are attested: `url`, `protocol`, `protocolVersion`, `contentHash`,
`rawHash`, `fetchedAt`. Never content. A build-time check rejects a schema that would carry
any.

## Running the whole thing locally

Two stand-ins let the full loop run with no API key, no funds and no mainnet. Both are
clearly labelled and neither belongs in a real deployment.

```sh
podman compose up -d                     # pgvector
bun scripts/demo/stub-embeddings.ts &    # deterministic vectors, NOT a real model
bun scripts/demo/mock-facilitator.ts &   # approves payments, settles NOTHING

cd apps/backend && bun run migration:run && cd -

export EMBEDDING_BASE_URL=http://127.0.0.1:39500
bun run wuzzy crawl https://docs.base.org/ --max=60
bun run wuzzy embed

bun run dev:backend      # open API on :3000
bun run dev:frontend     # search UI on :8080
```

To see the metered path, run a second backend with `X402_ENABLED=true` and
`X402_FACILITATOR_URL=http://127.0.0.1:39600`, then point the demo agent at it.

## Admin app

[apps/admin](apps/admin/) is a read-only view of the index: totals, which hosts the corpus
came from, the document list with filters, per-document provenance and fetch history, and
recent crawl activity.

It is a **separate app on its own origin**, not a page on the public site, so it can be kept
off the public internet entirely rather than hidden behind a path. Three things enforce that,
and each is checked by a test:

- The public site does not build an admin page or ship its script.
- The public site's nginx returns 404 for `/api/admin/`, and its dev server refuses the same
  prefix, so the two cannot disagree.
- The admin site's nginx proxies **only** `/api/admin/`; the public API is not reachable
  through it.

The backend half is off unless `ADMIN_ENABLED=true`, and a disabled instance answers 404
rather than 403 so it does not advertise itself. Set `ADMIN_TOKEN` for anything not bound to
loopback; without it there is no auth at all. In `compose.demo.yml` the admin app is
published on `127.0.0.1:8081` rather than all interfaces.

There is one global index. Documents are not owned by anyone and there is no tenancy, so
"which index" is not a question the schema can answer yet; the closest grouping is the host
a document came from, which the admin view shows.

## Demo agent

[apps/demo-agent](apps/demo-agent/) is a paying client, and doubles as the integration
quickstart for anyone pointing an agent at Wuzzy. It depends on nothing in `apps/backend`,
so it can be split out into its own repository whenever that is useful.

```sh
bun run demo wallet                                   # fresh key, stored outside the repo
bun run demo search "how do I deploy a contract"      # 402 -> pay -> results
```

Against an endpoint in dev mode it needs no wallet at all.

## Local development

Requires [Bun](https://bun.sh) and Podman or Docker for Postgres.

```sh
podman compose up -d        # or: docker compose up -d
cp .env.example .env
bun install

cd apps/backend && bun run migration:run && cd -

bun run dev:backend         # NestJS with watch on :3000
bun run dev:frontend        # static build + dev server on :8080, proxies /api → :3000
```

Compose files are engine-agnostic on purpose: dev machines run podman, cloud runs docker.

Run the suite with `bun test`, or a single scenario with
`bun test --test-name-pattern "thin pages are rejected"`. Tests that need Postgres skip
themselves when it is unreachable locally, and fail outright under `CI`.

## Database

The schema lives in
[apps/backend/src/database/migrations/](apps/backend/src/database/migrations/) as raw SQL,
because the `vector` extension and the hnsw index cannot be expressed as entities.
`synchronize` is off in every environment, not just production: TypeORM would drop the
indexes it cannot model.

| Table | Holds |
| ----- | ----- |
| `documents` | Latest state per URL: canonical content, both hashes, protocol version, embed and attestation bookkeeping |
| `fetch_log` | Append-only record of every fetch actually performed |
| `chunks` | Embeddable slices with a `vector(1536)` column and an hnsw index |

`/search` is hybrid: BM25 and vector similarity run independently over `chunks` and their
rankings are fused with Reciprocal Rank Fusion, then collapsed to the best chunk per document
and joined back to `documents` so every result carries the provenance block a paying agent
needs to check the claim itself. `mode` in the request body, or `SEARCH_MODE`, selects
`hybrid` (default), `vector` or `lexical`; `lexical` needs no embedding provider.

The BM25 scoring is computed in SQL rather than taken from `ts_rank`, which is not BM25 and
has neither an IDF term nor length normalisation. Each result reports the rank each arm gave
it, which is what you want when tuning.

Content changes clear `embedded_at` and `attestation_uid`, which is what makes the embed and
attest passes idempotent.

Run these from `apps/backend` (Bun auto-loads `.env`, so they target the same database as the
app):

```sh
bun run migration:generate src/database/migrations/<DescriptiveName>
bun run migration:run
bun run migration:revert
bun run migration:show
```

`migration:generate` diffs entities against the live schema, so have Postgres up first. It
cannot see the extension or the hnsw index; those go in by hand.

**Applying migrations on deploy.** Either run `bun run migration:run` as a one-off job before
rolling out the new version (preferred for multi-replica), or set `DB_MIGRATIONS_RUN=true` and
let the app migrate during startup (simple, single-instance). The container image includes
`typeorm` and the migration files, so both work inside it.

## Container images

Both Dockerfiles build from the **repository root**:

```sh
podman build -f apps/backend/Dockerfile  -t wuzzy-backend .
podman build -f apps/frontend/Dockerfile -t wuzzy-frontend .
```

- Backend (~494 MB): `oven/bun:1-alpine`, runs the TypeScript sources directly, listens on
  `$PORT` (default 3000), healthcheck on `/healthz`.
- Frontend (~70 MB): build stage pre-renders to `dist/`, final stage is `nginx:1-alpine` on
  port 80.

The backend install uses `--linker=hoisted` and then deletes two dependency trees that
nothing in the image imports: the browser wallet stack `x402` pulls in through `wagmi`, and
the hardhat/solc build toolchain `eas-sdk` pulls in through `eas-contracts`. Together they
were more than a third of the image. A `smoke` build stage loads every entry point after the
prune, and the runtime stage takes `node_modules` from that stage rather than from the install
stage, so the check cannot be skipped: removing something that is actually needed fails the
build instead of the deploy.

## CI / publishing

Every push and pull request: `bun install`, `bunx tsc --noEmit`, schema migration against a
pgvector service, `bun test`, the scenario coverage report, and a frontend smoke build.

Pushes to the default branch and `v*` tags additionally publish to GHCR:

- `ghcr.io/<owner>/<repo>-backend`
- `ghcr.io/<owner>/<repo>-frontend`

Tagged `latest` plus the full commit SHA on the default branch, and the semver version on
`v*` tags. Authentication uses the workflow's own `GITHUB_TOKEN`, so no registry secret is
needed.

## Layout

```
├── contracts/                  Gherkin feature files: the definition of done
├── fixtures/canonicalize-v1/   Conformance vectors for the pinned hash procedure
├── VERIFY.md                   Prose spec of that procedure
├── compose.yml                 Local backing services (pgvector)
├── .github/workflows/ci.yaml   Test + publish images
└── apps/
    ├── backend/                NestJS API, canonicalizer, schema
    └── frontend/               JSX → static HTML, nginx image
```
