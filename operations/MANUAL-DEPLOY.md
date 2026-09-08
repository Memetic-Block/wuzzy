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

The API will not start without a database, and nothing will run without a schema.

`wuzzy-pipeline.hcl` is **not** in this list. Nightly recrawl and refresh are parked while the
work is the demo and dogfooding it; the global index is seeded by hand with `wuzzy crawl` when
it needs to be. See [README.md](README.md) for what that defers.

    # 1. Database first. It has no dependencies.
    nomad job run operations/wuzzy-db.hcl

    # 2. The queue's broker. No volume and no migration; it holds no truth.
    nomad job run operations/wuzzy-redis.hcl

    # 3. Migrations, against the running database. There is no auto-migrate:
    #    `synchronize` is false everywhere, so this is deliberate every time.
    nomad alloc exec -task wuzzy-api-live-task <alloc> \
      sh -c 'cd apps/backend && bun run migration:run'

    # 4. API.
    nomad job run -var="commit_sha=${SHA}" -var="release_tag=0.1.0" \
      operations/wuzzy-api-live.hcl

    # 5. Crawl workers. The API only enqueues; without these a paid commission
    #    is recorded, charged and never fetched.
    nomad job run -var="commit_sha=${SHA}" operations/wuzzy-worker.hcl

    # 6. The attester. FUND IT FIRST: it starts writing receipts, including for
    #    the global index, as soon as it can reach the database.
    nomad job run -var="commit_sha=${SHA}" operations/wuzzy-attester.hcl

    # 7. Site.
    nomad job run -var="commit_sha=${SHA}" -var="commit_timestamp=${TS}" \
      -var="release_tag=0.1.0" operations/wuzzy-frontend-static-live.hcl

Step 3 is a chicken-and-egg: the API image carries the migration CLI, so run the API first,
let its health check fail, exec the migration, and it recovers. Alternatively run the
migration from any machine with the repo and a route to the database.

Steps 5 and 6 are not optional extras. The API takes payment and writes what is owed; the
worker is what fetches it and the attester is what proves it. Deploying only the API sells
an index that never fills.

**`wuzzy-attester` is `count = 1`, permanently.** Every batch is a transaction from one funded
account, so a second instance signs against the same nonce and discards a transaction it has
already paid for. Scale crawling with `wuzzy-worker`'s `count`; attestation scales by batch
size instead.

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

## Restoring the database

`pg_restore` rebuilds the hnsw index, which needs more shared memory than a container gets by
default. `wuzzy-db.hcl` sets `shm_size` for this; without it the restore appears to succeed and
only the vector index is missing, which shows up later as slow search rather than as an error.

Check for it explicitly after any restore:

    select indexname from pg_indexes where tablename = 'chunks';

`chunks_embedding_hnsw` must be in that list. If it is not, the restore logged
`could not resize shared memory segment` and the index can be created by hand once the shared
memory is large enough.

## Provisioning the attester

Once, before the first attest run. The schema itself is already registered on Base mainnet;
that was a separate one-time step and its UID is in [SCHEMA.md](../SCHEMA.md).

**Generate the key where it is allowed to live.** Not on a laptop: the whole point of running
attestation as a cluster job is that the funded key never reaches a developer machine, and a
key pasted through a local terminal is in that machine's scrollback and shell history whatever
happens to it afterwards. Generate it on the cluster and let only the address come back:

    nomad alloc exec -task wuzzy-api-live-task <alloc> \
      bun -e 'const w = require("ethers").Wallet.createRandom();
              console.log("address", w.address);
              console.log("key    ", w.privateKey)'

**Write both secrets to Vault.** `EAS_SCHEMA_UID` is read from `kv/wuzzy/api` and the key from
`kv/wuzzy/attester`, which is why the job declares two policies.

    vault kv patch kv/wuzzy/attester ATTESTER_PRIVATE_KEY=0x...
    vault kv patch kv/wuzzy/api \
      EAS_SCHEMA_UID=0x15616641fbb8e7ee6a63f4904a622a154972e47453062c845845e1f2387f9f1a \
      X402_CDP_API_KEY_ID=... X402_CDP_API_KEY_SECRET=...

`patch`, not `put`. `vault kv put` replaces every field in the secret, so putting
`EAS_SCHEMA_UID` into `kv/wuzzy/api` would silently drop `POSTGRES_PASSWORD` and everything
else beside it, and the next API deploy would fail its health check for no visible reason.

**Fund the address.** Any wallet, an ordinary transfer, Base mainnet. The browser wallet you
already hold ETH in is fine; it never signs an attestation, it only funds the address that
does. A full corpus run is about 0.017 ETH, so send meaningfully more than that: a run that
dies out of gas half way is recoverable, but only by funding it again and re-running.

**Check the balance before the run, not during it.**

    cast balance <attester-address> --rpc-url https://mainnet.base.org --ether

**Check the facilitator before anything quotes a price.** Wrong credentials and a facilitator
that does not cover Base both surface the same way, as a payer being turned away, and both are
free to rule out first:

    X402_CDP_API_KEY_ID=... X402_CDP_API_KEY_SECRET=... bun run check:facilitator

It asks the facilitator what it settles and fails unless that includes an exact payment on Base
mainnet. It never prints the credentials.

## Attesting

This one spends money. Read [SCHEMA.md](../SCHEMA.md) first for what it costs, and provision
the attester above first: with no key the job fails immediately with `ATTESTER_PRIVATE_KEY is
not set`, and with no UID it fails with `EAS_SCHEMA_UID is not set`. Both are cheap failures,
which is the intended behaviour: it refuses rather than attesting against a wrong schema.

    nomad job run -var="commit_sha=${SHA}" operations/wuzzy-attest.hcl
    nomad alloc logs -f <alloc-id>

Expect a line like `attested N document(s) in M batch(es)`. It is idempotent and resumable:
the work queue is `attestation_uid IS NULL` and backfill happens per batch, so a run that
fails part way leaves everything after the failure point still queued, and re-running is the
intended recovery.

Registering the schema was a separate one-time step, not a job, and it is done: the UID and
its registration transaction are in [SCHEMA.md](../SCHEMA.md). Note that a registered schema
proves only that the schema exists. It is not evidence that any page has been attested, and
`EAS_SCHEMA_URL` on the site should not be set on the strength of it alone.

## Verifying a deploy

    curl -s https://api.wuzzy.io/healthz
    curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.wuzzy.io/search \
      -H 'content-type: application/json' -d '{"query":"test"}'      # expect 402

A `402` proves the meter is on. A `200` there means `X402_ENABLED` is wrong and the index is
being given away.

A 402 does not prove a payment can be *settled*, though, which is a separate failure. Coinbase's
facilitator is the one that settles Base mainnet; the public endpoint at x402.org answers
`/supported` with base-sepolia and other testnets and no `eip155:8453`, so a deployment pointed
there quotes prices nobody can pay. The API refuses to start with the meter on and no way to
settle, so a successful boot is the check. Confirm what a facilitator covers before trusting it:

    curl -s https://x402.org/facilitator/supported | grep -o 'eip155:[0-9]*' | sort -u

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
