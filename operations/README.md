# Operations

Every deployable piece of Wuzzy, one Nomad job spec each. Specs are submitted by hand from a
machine that can reach the `mb-hel` cluster; see [MANUAL-DEPLOY.md](MANUAL-DEPLOY.md).

| Job | Type | Where it runs | What it is |
| --- | --- | --- | --- |
| [wuzzy-db.hcl](wuzzy-db.hcl) | service | `meta.env=store` | Postgres + pgvector. The only stateful thing. |
| [wuzzy-api-live.hcl](wuzzy-api-live.hcl) | service | `meta.env=store` | The public API at `api.wuzzy.io`. |
| [wuzzy-api-stage.hcl](wuzzy-api-stage.hcl) | service | `meta.env=store` | The same, at `api-stage.wuzzy.io`. |
| [wuzzy-frontend-static-live.hcl](wuzzy-frontend-static-live.hcl) | batch | `meta.env=edge-worker` | Builds the site and pushes it to Cloudflare Pages. |
| [wuzzy-frontend-static-stage.hcl](wuzzy-frontend-static-stage.hcl) | batch | `meta.env=edge-worker` | The same, to `stage.wuzzy.io`. |
| [wuzzy-admin.hcl](wuzzy-admin.hcl) | service | `meta.env=store` | Operations view on an internal hostname, with its own backend. |
| [wuzzy-pipeline.hcl](wuzzy-pipeline.hcl) | periodic batch | `meta.env=store` | Nightly crawl then embed. |
| [wuzzy-attest.hcl](wuzzy-attest.hcl) | batch | `meta.env=store` | Writes attestations to Base. Run by a human. |

## Three decisions worth knowing

**Frontends are static on Cloudflare Pages, and that removes the `/api` proxy.** The container
image serves the site through nginx, which proxies `/api` to the backend so the browser makes
same-origin requests. Pages has no nginx. The free search box therefore calls
`api.wuzzy.io` cross-origin, which is why the job sets `WEB_SEARCH_URL` and why the API sets
`WEB_SEARCH_ORIGINS=https://wuzzy.io`. Those two have to agree or the box fails CORS.

**The admin app is the exception and stays off Cloudflare.** It runs as an internal Nomad
service on `wuzzy-admin.hel.memeticblock.net`. Publishing it to Pages would make it public and
reduce the access decision to a Cloudflare Access rule, which is a control that can be turned
off by mistake; a hostname that does not resolve outside the network cannot be. It carries its
own backend instance, because the public API runs `ADMIN_ENABLED=false` and must keep doing so.

**Attesting is never automated.** It spends money and signs with a funded key. The key is
rendered from Vault into the task at run time, so it is not in this repository, the image, or
on a developer machine. The job is idempotent and resumable, so re-running after a partial
failure is the intended recovery rather than a risk.

## Replacing the old site

`wuzzy.io` is currently served by Cloudflare Pages from the
[wuzzy-site](https://github.com/Memetic-Block/wuzzy-site) repo, whose own
`operations/wuzzy-site-static-live.hcl` deploys the Vue/ArNS-era site.

These specs deploy to the **same Pages projects**, `wuzzy-site-live` and `wuzzy-site-stage`, so
the cutover needs no DNS change and no new custom domain binding. The tradeoff is that two
repositories can then publish to one project, and the last deploy wins.

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
| `wuzzy-admin.hel.memeticblock.net` | Traefik, internal only | n/a | **no, create it** |

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

### The admin hostname is a deliberate exception

It is the one name not under `wuzzy.io`. The invariant is that the admin surface stays off the
public internet, and an internal-only name cannot be reached from outside at all.

`admin.wuzzy.io` is available if you prefer the domain to be consistent, but only as a
**DNS-only** record to a private address: it would then resolve publicly while remaining
unroutable. Proxying it through Cloudflare would make it genuinely public, with `ADMIN_TOKEN`
as the only thing between the internet and the operations view. That is a weaker position than
a name that does not resolve, which is why it is not the default.

## What does not exist yet

None of this has been submitted to a cluster. These specs are written against the conventions
in `infra/` and `wuzzy-site/operations/`, but they are unvalidated until a real deploy runs.

Before a first deploy someone has to create:

- **A Nomad host volume `wuzzy-db`** on the `store` node, for the database.
- **Vault `kv/wuzzy/api`** with `POSTGRES_PASSWORD`, `EMBEDDING_API_KEY`, `X402_PAY_TO`,
  `EAS_SCHEMA_UID`, `ADMIN_TOKEN`, and a `wuzzy-api` policy that reads it.
- **Vault `kv/wuzzy/attester`** with `ATTESTER_PRIVATE_KEY`, and a `wuzzy-attester` policy.
  Separate from the above so the API's token cannot read the signing key.
- **DNS records**, per the table above.
- **A `wuzzy-frontend-deploy` image in CI.** The frontend Dockerfile has the stage
  (`--target deploy`); the workflow does not build it yet.
- **The EAS schema registered** on Base mainnet, which produces the `EAS_SCHEMA_UID` above.
  Its value is already known: see [SCHEMA.md](../SCHEMA.md).

The database has no backup job. That is a real gap, not an oversight to discover later.
