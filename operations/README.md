# Operations

Every deployable piece of Wuzzy, one Nomad job spec each. Specs are submitted by hand from a
machine that can reach the `mb-hel` cluster; see [MANUAL-DEPLOY.md](MANUAL-DEPLOY.md).

| Job | Type | Where it runs | What it is |
| --- | --- | --- | --- |
| [wuzzy-db.hcl](wuzzy-db.hcl) | service | `meta.env=store` | Postgres + pgvector. The only stateful thing. |
| [wuzzy-migrate.hcl](wuzzy-migrate.hcl) | batch | `meta.env=store` | Applies pending migrations and exits. Run before the API. |
| [stamp-sha.sh](stamp-sha.sh) | script | run locally | Sets the deployed image tag across every spec at once. |
| [wuzzy-api-live.hcl](wuzzy-api-live.hcl) | service | `meta.env=store` | The public API at `api.wuzzy.io`. |
| [wuzzy-api-stage.hcl](wuzzy-api-stage.hcl) | service | `meta.env=store` | The same, at `api-stage.wuzzy.io`. |
| [wuzzy-frontend-static-live.hcl](wuzzy-frontend-static-live.hcl) | batch | `meta.env=edge-worker` | Builds the site and pushes it to Cloudflare Pages. |
| [wuzzy-frontend-static-stage.hcl](wuzzy-frontend-static-stage.hcl) | batch | `meta.env=edge-worker` | The same, to `stage.wuzzy.io`. |
| [wuzzy-admin.hcl](wuzzy-admin.hcl) | service | `meta.env=store` | Operations view, private network only, with its own backend. |
| [wuzzy-redis.hcl](wuzzy-redis.hcl) | service | `meta.env=store` | Broker for the crawl and attest queues. No persistence, by design. |
| [wuzzy-worker.hcl](wuzzy-worker.hcl) | service | `meta.env=store` | Crawls and embeds what was paid for. Scale with `count`. |
| [wuzzy-attester.hcl](wuzzy-attester.hcl) | service | `meta.env=store` | Writes the receipts. Holds the funded key. **Exactly one.** |
| [wuzzy-pipeline.hcl](wuzzy-pipeline.hcl) | periodic batch | `meta.env=store` | Nightly crawl then embed, global index only. **Parked: not deployed.** |
| [wuzzy-attest.hcl](wuzzy-attest.hcl) | batch | `meta.env=store` | Corpus-wide attestation backfill. Run by a human. |

## What runs when

Two engines, and they do different work:

- **The queue** fulfils paid work. A commission settles, the API writes what is owed and
  enqueues, a worker crawls and embeds it, and the attester writes the receipts. Minutes, not
  overnight, because somebody paid and a batch window is not a defensible latency.
- **The nightly pipeline** keeps the *global* index current. It is the only thing that
  discovers new pages by following links and sitemaps, and the only thing that re-fetches a
  page that was already crawled successfully, using `--max-age` so a changed page invalidates
  its embedding and its attestation. The queue never revisits a URL it has satisfied.

So the pipeline is not redundant with the queue, and neither replaces the other.

**It is parked, deliberately, and is not part of the current deploy.** The work in front of us
is the demo and dogfooding it, both of which exercise the paid path: commission, crawl, embed,
attest, search. Recrawling and refresh serve a corpus that is being maintained over months,
which is not what is being demonstrated. `wuzzy-pipeline.hcl` stays in this directory and stays
unsubmitted; the global index is seeded by running `wuzzy crawl` by hand when it needs to be.

Two consequences to hold, rather than to fix now:

- **Nothing is ever re-fetched.** Every index, global included, holds whatever its pages said on
  the day they were crawled. The attestation stays truthful, because it records the fetch date,
  but a receipt makes stale content look checked rather than merely dated.
- **A commissioned index is never refreshed** even once the pipeline does run, because the
  sweeper's work queue is `crawled_at IS NULL` and the nightly job only targets global. Whether
  refresh is included in the page price, subscribed to, or bought again is an open product
  decision, and it is the one to make before selling indexes to anyone who keeps them.

## Order of deployment

Nothing here waits politely for a dependency that is absent, so submit in this order:

    wuzzy-db  ->  wuzzy-redis  ->  wuzzy-api-*  ->  wuzzy-worker  ->  wuzzy-attester

The API discovers Redis through Consul and logs an enqueue failure rather than failing a paid
request, so a missing broker degrades to sweeper latency instead of losing work. A worker with
no database exits and is restarted until there is one.

## Three decisions worth knowing

**Frontends are static on Cloudflare Pages, and that removes the `/api` proxy.** The container
image serves the site through nginx, which proxies `/api` to the backend so the browser makes
same-origin requests. Pages has no nginx. The free search box therefore calls
`api.wuzzy.io` cross-origin, which is why the job sets `WEB_SEARCH_URL` and why the API sets
`WEB_SEARCH_ORIGINS=https://wuzzy.io`. Those two have to agree or the box fails CORS.

**The admin app is the exception and stays off Cloudflare, and off Traefik.** It has no public
route: its port binds to the private network the way the database and the broker do, and
`nomad service info wuzzy-admin` gives the address to open. An earlier version routed
`wuzzy-admin.hel.memeticblock.net` through the public entrypoint and called the name internal.
That name resolves to the edge from anywhere, and requesting a certificate for it publishes it
in Certificate Transparency logs, so it was neither private nor obscure. Publishing it to Pages would make it public and
reduce the access decision to a Cloudflare Access rule, which is a control that can be turned
off by mistake; a hostname that does not resolve outside the network cannot be. It carries its
own backend instance, because the public API runs `ADMIN_ENABLED=false` and must keep doing so.

**Attesting spends money, so it is isolated rather than forbidden.** It used to be a job a
human submitted; it is now continuous, because an index carrying no receipts is not the product
being sold. What has not changed is the containment: the funded key is rendered from Vault into
one task at run time, so it is not in this repository, the image, or on a developer machine, and
the crawl workers that scale freely never carry one. `wuzzy-attester` is **count = 1** and that
is not a tuning knob: a second would sign from the same account, build against the same nonce,
and discard a transaction it had already paid for. Both it and the backfill job are idempotent
and resumable, because the work queue is documents with no uid, so re-running after a partial
failure is the intended recovery rather than a risk.

## Replacing the old site

`wuzzy.io` is currently served by Cloudflare Pages from the
[wuzzy-site](https://github.com/Memetic-Block/wuzzy-site) repo, whose own
`operations/wuzzy-site-static-live.hcl` deploys the Vue/ArNS-era site.

These specs deploy to the **same Pages projects**, `wuzzy-site-live` and `wuzzy-site-stage`, so
the cutover needs no DNS change and no new custom domain binding. The tradeoff is that two
repositories can then publish to one project, and the last deploy wins.

`PAGES_BRANCH` has to equal each project's **configured production branch**, which is `main`,
not the environment name. Cloudflare compares that string to the project setting to decide
production versus preview, and a mismatch does not fail: the job succeeds, prints a deployed
URL, and publishes to a `*.pages.dev` preview while the custom domain keeps serving whatever it
had. That is how the first cutover attempt appeared to work and changed nothing.

So the cutover is: deploy from here, confirm, then stop the old job and archive that repo.

    nomad job stop -purge wuzzy-site-static-live
    nomad job stop -purge wuzzy-site-static-stage

If you would rather keep them separate, change `PROJECT_NAME` in both specs to
`wuzzy-frontend-live` / `wuzzy-frontend-stage`, create those projects, and move the custom
domain over in Cloudflare. That is a DNS change during the cutover window rather than before
it, which is why it is not the default here.

## DNS

`wuzzy.io` is on Cloudflare nameservers, and `wuzzy.io` and `stage.wuzzy.io` already resolve to
Cloudflare (they are Pages, proxied). Everything else here is a subdomain of it.

| Name | Points at | Cloudflare proxy | Exists |
| --- | --- | --- | --- |
| `wuzzy.io` | Pages project `wuzzy-site-live` | proxied | yes |
| `stage.wuzzy.io` | Pages project `wuzzy-site-stage` | proxied | yes |
| `api.wuzzy.io` | Traefik on `mb-hel` | proxied | **no, create it** |
| `api-stage.wuzzy.io` | Traefik on `mb-hel` | proxied | **no, create it** |
| ~~`wuzzy-admin.hel.memeticblock.net`~~ | nothing. Admin has no public route | n/a | **do not create** |

**The proxy setting and `WEB_SEARCH_PROXY_HOPS` are one decision, not two.** Proxied, the chain
is client to Cloudflare to Traefik, so the client address is the second entry from the right of
`X-Forwarded-For` and the API must set `2`. DNS-only, it is `1`. The specs here assume proxied,
matching the rest of the zone.

Setting it wrong does not fail loudly. The rate limiter keys every request on Traefik's view of
Cloudflare, so all visitors share one bucket and the free search box stops answering for
everyone after ten queries a minute. [MANUAL-DEPLOY.md](MANUAL-DEPLOY.md) has a curl that
catches it.

Both API records are POST-only in practice, and Cloudflare does not cache POST, so proxying
them does not risk serving a paid result to an unpaid request.

### Admin has no hostname, deliberately

The invariant is that the admin surface stays off the public internet, and a hostname does not
provide that. `wuzzy-admin.hel.memeticblock.net` already resolves to the edge, so routing it
through the public Traefik entrypoint published the operations view to anyone who sent that Host
header, and a certificate request would have listed the name in Certificate Transparency logs.
It has no route now; reach it over the private network.

`admin.wuzzy.io` is available if you prefer the domain to be consistent, but only as a
**DNS-only** record to a private address: it would then resolve publicly while remaining
unroutable. Proxying it through Cloudflare would make it genuinely public, with `ADMIN_TOKEN`
as the only thing between the internet and the operations view. That is a weaker position than
a name that does not resolve, which is why it is not the default.

## What does not exist yet

None of this has been submitted to a cluster. These specs are written against the conventions
in `infra/` and `wuzzy-site/operations/`, but they are unvalidated until a real deploy runs.

They are also plain HCL rather than HCL2, because the cluster's Nomad predates variable
support. That is why the image tag is written into each file and set with
[stamp-sha.sh](stamp-sha.sh) rather than passed as `-var` at submit time. If Nomad is upgraded
later, moving back to variables is worth doing: a literal tag in thirteen places is only safe
while one command maintains all of them.

**The embedding provider is Gemini, and 1536 is not a free choice.** The API, worker and
pipeline call `gemini-embedding-001` through Google's OpenAI-compatible layer, which is the
shape [embedder.ts](../apps/backend/src/embed/embedder.ts) already speaks, so switching provider
was configuration rather than code. The size is constrained from two directions: the `chunks`
column is `vector(1536)`, and pgvector cannot build an hnsw index above **2000** dimensions. The
model returns 3072 by default and truncates on request, so leaving `EMBEDDING_DIMENSIONS` unset
would produce vectors that are both wrong for the column and too wide to index. Any future
provider has to hit 1536 or bring a migration of the column and its index with it.

Before a first deploy someone has to create:

- **A Nomad host volume `wuzzy-db`** on the `store` node, for the database.
- **Vault `kv/wuzzy/api`** with `POSTGRES_PASSWORD`, `EMBEDDING_API_KEY`, `X402_PAY_TO`,
  `EAS_SCHEMA_UID`, `ADMIN_TOKEN`, `X402_CDP_API_KEY_ID`, `X402_CDP_API_KEY_SECRET`, and a
  `wuzzy-api` policy that reads it. Write these with `vault kv patch`, never `put`: `put`
  replaces every field in the secret and would drop the rest of them.
- **Vault `kv/wuzzy/attester`** with `ATTESTER_PRIVATE_KEY`, and a `wuzzy-attester` policy.
  Separate from the above so the API's token cannot read the signing key. The attester and
  backfill jobs declare **both** policies, because they read the database password and schema
  uid from one path and the key from the other; that does not weaken the separation, since the
  API job still declares only `wuzzy-api` and so cannot reach the key.
- **DNS records**, per the table above.
- **A `wuzzy-frontend-deploy` image in CI.** The frontend Dockerfile has the stage
  (`--target deploy`); the workflow does not build it yet.

The EAS schema is registered on Base mainnet already, so `EAS_SCHEMA_UID` is a known value
rather than something to produce: see [SCHEMA.md](../SCHEMA.md).

**Fund the attester before submitting `wuzzy-attester`.** It attests continuously, including the
global index, so it starts spending as soon as it can reach a database. A full pass over the
existing corpus is roughly 0.009 ETH at the gas in SCHEMA.md; send meaningfully more, because a
run that dies out of gas is only recoverable by funding it again.

The database has no backup job. That is a real gap, not an oversight to discover later.
