# Wuzzy

A search index for AI agents, where every result carries onchain proof of what was crawled
and when.

Wuzzy crawls documentation sites in the open, canonicalizes each page through a pinned public
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
bun run wuzzy crawl https://docs.base.org   # fetch, canonicalize, write provenance
bun run wuzzy embed                         # chunk and embed whatever is pending
bun run wuzzy attest                        # multiAttest anything without a UID
bun run wuzzy verify <url>                  # re-derive the hash for one indexed URL
```

`verify` exits 0 on a match, 1 on a mismatch, and 2 when the URL is not indexed, so it drops
straight into a script.

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

`/search` runs vector top-k over `chunks`, collapses to the best chunk per document, and joins
back to `documents` so every result carries the provenance block a paying agent needs to check
the claim itself.

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

- Backend: `oven/bun:1`, runs the TypeScript sources directly, listens on `$PORT` (default
  3000), healthcheck on `/healthz`.
- Frontend: build stage pre-renders to `dist/`, final stage is `nginx:1-alpine` on port 80.

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
