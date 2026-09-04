# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Invariants

These are not preferences. A change that breaks one of them is wrong even if it passes CI.

- Crawler is transparent: WuzzyBot user-agent, robots.txt respected, no stealth,
  no fingerprint evasion, no proxy rotation — ever.
- src/canonicalize/v1 is FROZEN once the first mainnet attestation lands; behavior
  changes are v2 in a new module. v1 stays callable forever.
- Only hashes + metadata go onchain. Never content.
- No funded keys in this repo, in sessions, or on this machine. Scenarios tagged
  @mainnet @manual are run by a human, never by CI or agents.
- Work commits straight to master unless Jim asks for a branch. Keep it green: the
  definition of done is still scenarios passing and CI green, just without the PR. This
  supersedes the agent-branch-and-PR working agreement in
  [docs/wuzzy-v2-work-breakdown.md](docs/wuzzy-v2-work-breakdown.md), which is a dated
  planning artifact and is not edited to match.
- contracts/*.feature files are the definition of done for every work item.

The canonicalizer lives at [apps/backend/src/canonicalize/v1/](apps/backend/src/canonicalize/v1/) in this
monorepo layout; `src/canonicalize/v1` above names the same module.

Two library defaults work against the transparency invariant and have to be overridden
explicitly, so check them whenever crawler code changes:

- Crawlee's `respectRobotsTxtFile: true` evaluates rules against `*`, not against the
  user-agent you send. Pass the object form, `{ userAgent: 'WuzzyBot' }`, or the crawler
  obeys a group it is not identifying as.
- Crawlee fetches `robots.txt` itself with a browser-like user-agent, and
  `preNavigationHooks` do not cover that request. The honest UA has to be configured
  where it applies to every request the process makes.

## Commands

```sh
podman compose up -d              # pgvector on :5432 (docker compose works too)
cp .env.example .env
bun install

bun run dev:backend               # NestJS with watch on :3000
bun run dev:frontend              # static build + dev server on :8080, proxies /api → :3000

bun run wuzzy crawl <seed-url>... # pipeline stages are CLI commands
bun run wuzzy embed
bun run wuzzy verify <url>        # exits 0 match, 1 mismatch, 2 not indexed
bun run demo search "<query>"     # the paying client; no wallet needed in dev mode

bun test                          # everything
bun test apps/backend/src/canonicalize          # one directory
bun test --test-name-pattern "thin pages"       # one scenario by name
bun run typecheck                 # bunx tsc --noEmit, covers both apps and scripts
bun run scenarios                 # contract coverage report, per feature file
```

Schema changes go through migrations; `synchronize` is off everywhere (see below).

```sh
cd apps/backend
bun run migration:run
bun run migration:revert
bun run migration:show
```

## Architecture

A monorepo of bun workspaces. `apps/backend` is a NestJS API on the Bun runtime with
TypeORM against Postgres + pgvector; `apps/frontend` pre-renders JSX pages to static HTML
at build time and is served by nginx; `apps/demo-agent` is a paying client. Pipeline stages
(crawl, embed, attest, verify) are CLI commands, not queue workers, so there is no broker in
the stack.

**apps/demo-agent must not import from apps/backend.** It is the integration quickstart a
third party reads, so it has to demonstrate what an outsider can build with the public API
alone, and it is expected to be split into its own repository by `git subtree split`. A
shared import would make both of those false. Its wallet file defaults to
`~/.config/wuzzy/demo-wallet.json`, outside the working tree, so a funded key cannot reach a
commit.

**Contracts drive the build.** `contracts/*.feature` files are the spec of record, split
out of [docs/wuzzy-bdd-contracts.md](docs/wuzzy-bdd-contracts.md). Tests declare which
scenario they implement by calling `scenario('name from the feature file', ...)` from
[apps/backend/src/testing/scenario.ts](apps/backend/src/testing/scenario.ts), and
[scenario-coverage.spec.ts](apps/backend/src/testing/scenario-coverage.spec.ts) enforces the
mapping in both directions: a scenario in an enforced feature with no test fails the build,
and a `scenario()` name that matches no feature file fails it too. Rename a scenario in the
feature file first, never in the test.

`ENFORCED_FEATURES` in
[feature-scenarios.ts](apps/backend/src/testing/feature-scenarios.ts) lists the features that
must be fully covered. Add a feature to it in the same commit that lands its implementation;
until then its scenarios are reported by `bun run scenarios` but do not block CI. Scenarios
tagged `@mainnet` or `@manual` are excluded from CI entirely, and a test claiming one of
those names is itself a build failure.

**The canonicalizer is a protocol artifact, not a utility.**
[apps/backend/src/canonicalize/v1/](apps/backend/src/canonicalize/v1/) is the pinned procedure
every `protocolVersion=1` attestation refers to: Readability extraction, Turndown with atx
headings / fenced code / `-` bullets / `*` emphasis, then NFC, LF, strip trailing whitespace,
collapse 3+ newlines to 2, trim, single trailing newline, sha256. Nothing else in the repo
computes a content or raw hash. Its conformance vectors live in
[fixtures/canonicalize-v1/](fixtures/canonicalize-v1/): the input files are authored by hand
and are the spec, while the `.md` and `.hash` outputs are generated by
`bun scripts/generate-canonicalize-vectors.ts`, human-reviewed, and then frozen. Regenerating
a vector that already exists is a protocol change, not a fix.

**The database schema is migration-only.**
[apps/backend/src/database/migrations/](apps/backend/src/database/migrations/) holds raw SQL
because the `vector` extension and the hnsw index have no entity expression. `synchronize` is
`false` in every environment, not just production: TypeORM would drop the hnsw index and the
partial work-queue indexes it cannot model. Entities cover the columns and are exercised
against the migrated schema by
[schema.spec.ts](apps/backend/src/database/schema.spec.ts), which skips when the database is
unreachable locally but fails outright under `CI`.

Specs that touch the database truncate in `beforeAll` as well as `afterEach`, via
[testing/database.ts](apps/backend/src/testing/database.ts). A spec that counts rows must not
depend on a pristine database, or a leftover row from a manual `wuzzy crawl` fails it for
reasons unrelated to the code.

`documents` holds latest state per URL; `fetch_log` is append-only and records every fetch
actually performed; `chunks` carries the embeddings. Content changes clear `embedded_at` and
`attestation_uid` so the embed and attest passes pick the document up again, which is what
makes both passes idempotent.

**Crawlee schedules; we do the fetching.** [crawl/crawler.ts](apps/backend/src/crawl/crawler.ts)
uses `BasicCrawler` for the request queue, concurrency and retries, but every request goes
through [crawl/http.ts](apps/backend/src/crawl/http.ts). Two reasons, both load-bearing:
Crawlee's HTTP crawlers hand back a decoded string, which does not reproduce the origin's
bytes for a page that is not UTF-8 and would therefore corrupt the raw hash; and owning the
fetch is what makes the honest user-agent checkable on every request rather than on the ones a
hook happens to cover. robots.txt and sitemaps are fetched the same way, then parsed.

**The meter mirrors the reference x402 middleware.**
[payment/payment.service.ts](apps/backend/src/payment/payment.service.ts) follows the same
sequence as `x402-express`: build requirements, 402 when the header is absent, malformed or
unmatched, verify with the facilitator, and settle only after the handler produced a response,
so a failed query is never charged for. Scenarios run against a mock facilitator; real
settlement is `@mainnet @manual`.

## Conventions

Bun auto-loads `.env`, so the app and the migration CLI read the same values. Both build
their connection from `buildDataSourceOptions` in
[typeorm.config.ts](apps/backend/src/database/typeorm.config.ts) so they cannot drift.

compose files stay engine-agnostic: dev machines run podman, cloud runs docker, so no
docker-only extensions.
