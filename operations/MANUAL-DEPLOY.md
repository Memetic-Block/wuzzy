# Manual deployment

CI builds and publishes images. It does not deploy: GitHub-hosted runners have no route to
Nomad or Vault on the `mb-hel` network. Deploys are run by hand from a machine that can reach
the cluster, the same arrangement as `wuzzy-site`.

## Prerequisites

- `nomad` CLI, with `NOMAD_ADDR` and `NOMAD_TOKEN` set for `mb-hel`
- A token with `submit-job`, plus access to the Vault policies each job declares
  (`wuzzy-api`, `wuzzy-attester`, `memeticblock-io-cloudflare-deployer`). Nomad reads those
  secrets itself, so you do not need Vault credentials locally.
- The image for the commit must already exist:

      docker manifest inspect ghcr.io/memetic-block/wuzzy-backend:<sha>

  CI only publishes on a successful run, so a commit whose workflow failed has no image and
  cannot be deployed.

## Job variables

Build metadata is passed with `-var` at submit time; nothing is templated into the files, so
the specs stay clean in git. Omitting a required variable fails at parse time with
`Unset variable "<name>"`, before anything reaches the cluster.

    SHA=$(git rev-parse origin/master)
    TS=$(date -u -d "$(git show -s --format=%cI "$SHA")" +"%Y-%m-%dT%H:%M:%SZ")

`commit_sha` does double duty: it selects the image tag and is reported by the deployed build.

## Order matters on a first deploy

The API will not start without a database, and the pipeline will not run without a schema.

    # 1. Database first. It has no dependencies.
    nomad job run operations/wuzzy-db.hcl

    # 2. Migrations, against the running database. There is no auto-migrate:
    #    `synchronize` is false everywhere, so this is deliberate every time.
    nomad alloc exec -task wuzzy-api-live-task <alloc> \
      sh -c 'cd apps/backend && bun run migration:run'

    # 3. API.
    nomad job run -var="commit_sha=${SHA}" -var="release_tag=0.1.0" \
      operations/wuzzy-api-live.hcl

    # 4. Site.
    nomad job run -var="commit_sha=${SHA}" -var="commit_timestamp=${TS}" \
      -var="release_tag=0.1.0" operations/wuzzy-frontend-static-live.hcl

Step 2 is a chicken-and-egg: the API image carries the migration CLI, so run the API first,
let its health check fail, exec the migration, and it recovers. Alternatively run the
migration from any machine with the repo and a route to the database.

## Deploying the site

Stage takes no `release_tag`; it defaults.

    nomad job run -var="commit_sha=${SHA}" -var="commit_timestamp=${TS}" \
      operations/wuzzy-frontend-static-stage.hcl

Both are `type = "batch"` with no restart or reschedule, so the job runs once and either
completes or fails.

    nomad job status wuzzy-frontend-static-live
    nomad alloc logs -f <alloc-id>

The task runs the static build and then `wrangler pages deploy`. Expect the log to end with
wrangler reporting the deployment URL.

If you redeploy the same sha, Nomad may treat the submission as unchanged and not schedule a
new allocation. `nomad job stop -purge <job-name>` clears that.

## Attesting

This one spends money. Read [SCHEMA.md](../SCHEMA.md) first for what it costs.

    nomad job run -var="commit_sha=${SHA}" operations/wuzzy-attest.hcl
    nomad alloc logs -f <alloc-id>

Expect a line like `attested N document(s) in M batch(es)`. It is idempotent and resumable:
the work queue is `attestation_uid IS NULL` and backfill happens per batch, so a run that
fails part way leaves everything after the failure point still queued, and re-running is the
intended recovery.

Registering the schema is a separate one-time step, not a job. Its command and the resulting
UID are in [SCHEMA.md](../SCHEMA.md).

## Verifying a deploy

    curl -s https://api.wuzzy.io/healthz
    curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.wuzzy.io/search \
      -H 'content-type: application/json' -d '{"query":"test"}'      # expect 402

A `402` proves the meter is on. A `200` there means `X402_ENABLED` is wrong and the index is
being given away.

    curl -s -X POST https://api.wuzzy.io/web-search \
      -H 'content-type: application/json' -H 'Origin: https://wuzzy.io' \
      -d '{"query":"base","topK":1}' -D- | grep -i access-control-allow-origin

The site's search box is cross-origin, so a missing `Access-Control-Allow-Origin` here is the
box being broken on a site that otherwise looks fine. It is the check most worth doing after
a cutover, because nothing else surfaces it.

Then confirm the rate limiter is keying on the caller and not on Cloudflare. Eleven requests
in a minute from one machine should end in a `429`:

    for i in $(seq 1 11); do
      curl -s -o /dev/null -w '%{http_code} ' -X POST https://api.wuzzy.io/web-search \
        -H 'content-type: application/json' -d '{"query":"base","topK":1}'
    done; echo

Expect ten `200`s then a `429`. If the `429` arrives much earlier than that, or if a colleague
on another network is already being limited, `WEB_SEARCH_PROXY_HOPS` does not match the
Cloudflare proxy setting on the record and every visitor is sharing one bucket. See the DNS
section of [README.md](README.md).

    curl -s -o /dev/null -w '%{http_code}\n' https://api.wuzzy.io/admin/stats   # expect 404

The public API must not serve the admin routes. `404` rather than `403` is correct: a disabled
surface should not advertise that it exists.
