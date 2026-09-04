# Repository Template — NestJS + HTMX on Bun

Bare-bones template for the usual Memetic Block stack:

- **Backend** — [apps/backend](apps/backend/): NestJS (TypeScript) on the Bun runtime, with BullMQ + Redis and TypeORM + Postgres wired in (both removable, see below).
- **Frontend** — [apps/frontend](apps/frontend/): HTMX pages written as JSX templates, pre-rendered to static HTML at build time by [build.ts](apps/frontend/build.ts) (no framework, zero runtime deps), styled with Tailwind CSS (compiled at build time from [src/styles.css](apps/frontend/src/styles.css)), served by nginx in production.
- **CI** — [.forgejo/workflows/ci.yaml](.forgejo/workflows/ci.yaml): Forgejo Actions workflow that tests both apps and publishes two Docker images to the Forgejo container registry.

Use it on Forgejo via *New repository → Template*, or branch/tag this repo for stack variants.

## Local development

Requires [Bun](https://bun.sh) and Docker or Podman (for Redis/Postgres).

```sh
docker compose up -d        # or: podman compose up -d
cp .env.example .env
bun install
bun run dev:backend         # NestJS with watch on :3000
bun run dev:frontend        # static build + dev server on :8080, proxies /api → :3000
```

Open http://localhost:8080 — the page wires up three HTMX demos against the backend: **Greet** fetches an HTML fragment, the **Database** form adds and lists rows via TypeORM/Postgres, and **Enqueue job** pushes a BullMQ job to Redis (watch the backend logs for the processor output).

Run all tests with `bun test`.

## Removing Redis (BullMQ) or Postgres (TypeORM)

The integrations are isolated so a new project can strip what it doesn't need:

| To remove   | Delete                                                | Then |
| ----------- | ----------------------------------------------------- | ---- |
| Redis/BullMQ | [apps/backend/src/queue/](apps/backend/src/queue/)   | Drop `QueueModule` from [app.module.ts](apps/backend/src/app.module.ts); remove `@nestjs/bullmq` + `bullmq` from [apps/backend/package.json](apps/backend/package.json); remove the `redis` service from [compose.yaml](compose.yaml) and `REDIS_*` from [.env.example](.env.example) |
| Postgres/TypeORM | [apps/backend/src/database/](apps/backend/src/database/) | Drop `DatabaseModule` from [app.module.ts](apps/backend/src/app.module.ts); remove `@nestjs/typeorm`, `typeorm` + `pg` from [apps/backend/package.json](apps/backend/package.json); remove the `postgres` service from [compose.yaml](compose.yaml) and `POSTGRES_*` from [.env.example](.env.example) |

Note: the database module auto-creates the schema from entities (`synchronize`) outside production, and the full-stack compose enables it explicitly via `DB_SYNCHRONIZE=true` so the demo runs without migrations. Real projects should turn this off and switch to migrations (see below).

## Database migrations

In stage/live, `synchronize` is **off** (it's only on outside production or when `DB_SYNCHRONIZE=true`), so schema changes are applied through TypeORM migrations instead.

The connection is defined once in [typeorm.config.ts](apps/backend/src/database/typeorm.config.ts) and shared by both the running app and the migration CLI ([data-source.ts](apps/backend/src/database/data-source.ts)), so they can't drift. Migrations live in [apps/backend/src/database/migrations/](apps/backend/src/database/migrations/).

Run these from `apps/backend` (Bun auto-loads `.env`, so they target the same database as the app):

```bash
# after changing an entity — diffs entities against the DB and writes a migration
bun run migration:generate src/database/migrations/<DescriptiveName>

# apply / roll back / inspect
bun run migration:run
bun run migration:revert
bun run migration:show
```

`migration:generate` needs the database reachable (it diffs the live schema), so have the `postgres` service up first.

**Applying migrations on deploy.** Two options:

- **Dedicated step (recommended for multi-replica):** run `bun run migration:run` as a one-off job/init container before rolling out the new app version, so exactly one process migrates.
- **On boot (simple, single-instance):** set `DB_MIGRATIONS_RUN=true` and the app runs pending migrations during startup.

The container image includes `typeorm` and the migration files, so `bun run migration:run` works inside it.

## Docker images

Both Dockerfiles build from the **repository root**:

```sh
docker build -f apps/backend/Dockerfile  -t backend .
docker build -f apps/frontend/Dockerfile -t frontend .
```

- Backend: `oven/bun:1`, runs the TypeScript sources directly, listens on `$PORT` (default 3000), healthcheck on `/healthz`.
- Frontend: build stage pre-renders to `dist/`, final stage is `nginx:1-alpine` on port 80.

## CI / publishing

The workflow runs on the `debian-bookworm` runner (which must provide a Docker daemon and outbound network access to fetch actions).

- Every push: `bun install`, `bun test`, frontend smoke build.
- Pushes to the default branch and `v*` tags additionally publish images to the Forgejo registry:
  - `git.memeticblock.net/<owner>/<repo>-backend`
  - `git.memeticblock.net/<owner>/<repo>-frontend`
  - Tagged `latest` + short commit SHA on the default branch, and the semver version on `v*` tags.

Required repository secrets:

| Secret | Value |
| ------ | ----- |
| `REGISTRY_TOKEN` | Forgejo access token with `package:write` scope |

## Layout

```
├── package.json                bun workspaces (apps/*), root scripts
├── tsconfig.base.json          shared strict TS config
├── compose.yaml                local dev backing services (redis, postgres)
├── .forgejo/workflows/ci.yaml  test + publish images
└── apps/
    ├── backend/                NestJS API (HTMX fragments under /api)
    └── frontend/               JSX → static HTML, nginx image
```
