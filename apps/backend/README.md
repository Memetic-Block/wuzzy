# Wuzzy backend

NestJS on the Bun runtime, TypeORM against Postgres + pgvector. It serves the REST API
documented here and hosts the pipeline CLI (`wuzzy crawl`, `embed`, `attest`, `verify`),
which are commands rather than queue workers, so there is no broker in the stack.

```sh
bun run dev:backend            # watch mode on :3000
bun run wuzzy crawl <seed>...  # pipeline stages are CLI commands
```

## Routing

The backend serves paths at the root: `/search`, `/indexes`, `/healthz`. In a deployed stack
nginx fronts it and proxies `/api/*`, stripping the prefix, so a browser calls `/api/search`
and this process sees `/search`. The public site's nginx returns 404 for `/api/admin/`, so
the admin surface cannot be reached from the public origin at all.

Everything is JSON in and JSON out. Failures are `{"error": "..."}` and the status code
carries the meaning.

| Method | Path | Gate | Purpose |
| --- | --- | --- | --- |
| `POST` | `/search` | x402 payment | Metered search, any index |
| `POST` | `/web-search` | rate limit, off by default | Free search of the global index |
| `GET` | `/indexes` | open | Catalog of listed indexes |
| `GET` | `/indexes/:reference` | open | One index and its crawl status |
| `POST` | `/indexes` | x402 payment | Commission an index |
| `POST` | `/indexes/:reference/urls` | x402 payment, owner only | Append URLs |
| `DELETE` | `/indexes/:reference` | x402 signature, owner only | Delete membership |
| `GET` | `/admin/*` | `x-admin-token`, off by default | Read-only operations views |
| `GET` | `/healthz` | open | Liveness |

`:reference` is an index id or its slug; both resolve.

## How payment works

`/search` and the write side of `/indexes` are keyless. There are no accounts and no API
keys: a signed payment is the only credential, over
[x402](https://x402.org). The sequence mirrors the reference `x402-express` middleware.

1. Call without an `X-PAYMENT` header. The server answers **402** with an `accepts` array
   describing what it will take.
2. Sign an authorization matching one entry and retry with it base64 encoded in `X-PAYMENT`.
3. The server verifies with the facilitator, runs the handler, and only then settles,
   returning an `X-PAYMENT-RESPONSE` header.

Two ordering guarantees are deliberate and covered by scenarios:

- **Settlement happens after the response body exists**, so a query that fails is never
  charged for.
- **Access control sits between verify and settle.** A verified payment is what proves
  control of the payer wallet, so it has to come first, but a caller who is not permitted
  gets their 403 without being charged for finding out.

A 402 body looks like this:

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "10000",
      "resource": "https://api.wuzzy.io/search",
      "description": "One Wuzzy search query with onchain provenance",
      "mimeType": "application/json",
      "payTo": "0x2222222222222222222222222222222222222222",
      "maxTimeoutSeconds": 60,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" }
    }
  ]
}
```

Setting `X402_ENABLED=false` opens every metered route. That is a development-only switch:
with no payer there is also no allowlist enforcement, because there is no wallet to check.

[apps/demo-agent](../demo-agent/) is a worked client. It deliberately imports nothing from
this app, so it demonstrates what an outsider can build against the public API alone.

## POST /search

Metered search. Scoped to one index, always: an absent `index` resolves to the global one.

**Request**

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `query` | string | required | Blank gives 400 |
| `topK` | number | `10` | Clamped to 1..50 |
| `offset` | number | `0` | Documents to skip, for paging |
| `mode` | string | `SEARCH_MODE` | `hybrid`, `vector` or `lexical`; tuning aid |
| `index` | string | global | Index id or slug |

```sh
curl -X POST https://api.wuzzy.io/search \
  -H 'content-type: application/json' \
  -H "X-PAYMENT: $PAYMENT" \
  -d '{"query":"base batches","topK":1}'
```

**Response**

```json
{
  "query": "base batches",
  "index": "global",
  "offset": 0,
  "topK": 1,
  "total": 103,
  "exhaustive": false,
  "hasMore": true,
  "results": [
    {
      "url": "https://docs.base.org/get-started/base-batches",
      "title": "Base Batches - Base Documentation",
      "snippet": "# Base Batches - Base Documentation Base Batches is an accelerator ...",
      "score": 0.03028233151183971,
      "ranks": { "lexical": 12, "vector": 1 },
      "provenance": {
        "protocol": "wuzzy/crawl-experimental",
        "protocolVersion": 1,
        "contentHash": "92628793bca6441354ccf481673e5d4b597ee52fa849e66356044a3df96cf126",
        "fetchedAt": "2026-09-06T04:28:39.359Z",
        "attestationUid": null,
        "attestationUrl": null
      }
    }
  ]
}
```

### Reading the response

`total` **is a floor, not a count, whenever `exhaustive` is false.** Both arms retrieve a
fixed number of candidates (`SEARCH_CANDIDATES`) and fusion reorders those; a corpus can hold
more matches than the window saw. Render `103+` rather than claiming a corpus-wide total.
Page with `hasMore` rather than by comparing `offset` against `total`.

The retrieval window is fixed and does not grow with `offset`. That is what stops pages
reordering under a reader: asking an arm for more does not merely append worse matches, it
lets a chunk that was outside the window enter the fusion and move up a page already seen.

`ranks` reports where each arm placed the result, which is a tuning aid rather than a
contract. Scores come from Reciprocal Rank Fusion, so they are small and comparable only
within one response.

`provenance` is the point of the product. `contentHash` is sha256 over the canonical markdown
produced by the pinned procedure named in `protocol` and `protocolVersion`, and
`attestationUrl` links to that attestation on easscan once one exists. Anyone can re-derive
the hash from the live page using [VERIFY.md](../../VERIFY.md) and check it themselves. The
pair `(protocol, protocolVersion)` identifies the procedure; the version alone never does.

`attestationUid` and `attestationUrl` are `null` until `wuzzy attest` has run over that
document.

## POST /web-search

The free half of search: a box on the public site, for people, who cannot sign an x402
payment in a browser. Same response shape as `/search`, provenance included, because a result
whose attestation a reader cannot click is not a receipt.

It is a separate route rather than a mode of `/search` on purpose. The metered path's
scenarios are a contract, and the way to keep them true is to leave that handler alone.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `query` | string | required | Blank gives 400 |
| `topK` | number | `10` | Clamped to 1..20, lower than `/search` |
| `offset` | number | `0` | |

Two rules make it safe to leave open:

- **It takes no `index` parameter at all** and always reads the global index. Access control
  rides x402, so an unmetered route that let a caller name an index would read a private one
  for free. There is no scoping to abuse because there is no scoping.
- **It is off unless `WEB_SEARCH_ENABLED=true`**, and a disabled instance answers 404 rather
  than 403, so it does not advertise itself.

Rate limiting is a fixed window per client, counted per replica rather than per cluster: the
point is to stop one client hammering a free endpoint, not to meter precisely, and a shared
counter would put a broker in a stack that deliberately has none. Over the limit gives **429**
with a `Retry-After` header.

Clients are keyed by an address anonymized to a /24 or /64, which is what makes the privacy
policy's "we do not store full addresses" true of the limiter rather than merely intended.
The address is taken from `X-Forwarded-For` counting `WEB_SEARCH_PROXY_HOPS` from the right,
because the leftmost entry is whatever the client claimed and keying on it would hand anyone
an unlimited allowance. Set the hop count to the deployment: 1 for nginx alone, 2 behind a
CDN, 0 when nothing fronts the process.

CORS echoes back only an origin on `WEB_SEARCH_ORIGINS` and always sends `Vary: Origin`.
Responses carry `Cache-Control: public, max-age=WEB_SEARCH_CACHE_SECONDS`, which is safe
because the route is unscoped and unauthenticated, so the same query returns the same page
for everyone.

## Indexes

One shared document store; an index is a membership view over it. A URL two indexes both want
is crawled, canonicalized and attested exactly once. "Global" is not a special case, it is a
row owned by the operator wallet with `visibility=listed` and `read_policy=open`.

### GET /indexes

The public catalog, global first. Unlisted indexes are absent entirely.

```json
{
  "indexes": [
    {
      "id": "8d679bf6-26c1-48c1-9b0f-b951db568d07",
      "slug": "global",
      "name": "Wuzzy global index",
      "owner": "0x0000000000000000000000000000000000000000",
      "visibility": "listed",
      "readPolicy": "open",
      "pageCap": null,
      "createdAt": "2026-09-05T19:53:57.283Z"
    }
  ]
}
```

### GET /indexes/:reference

The same fields plus live crawl progress. 404 if the reference resolves to nothing.

```json
{
  "id": "e3b69e4e-...", "slug": "account-abstraction", "status": "ready",
  "pages": 250, "attestations": 0, "pending": 0,
  "statusUrl": "/indexes/e3b69e4e-..."
}
```

`status` is **derived from the crawl queue, never stored**, so it cannot disagree with the
work outstanding: `pending` when nothing has been crawled yet, `crawling` while some has,
`ready` when no queued URL remains. `pages` counts membership rows, `attestations` how many of
those carry a UID, `pending` how many paid-for URLs the store does not hold yet.

`pageCap` on an index row is a snapshot of the configured cap when it was created, which is
why older indexes can show a different number from the current `WUZZY_INDEX_PAGE_CAP`.

### POST /indexes

Commissions an index. Priced per page and quoted from the request body alone, so the amount
in the 402 is exactly the amount the client signs for.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `urls` | string[] | required | Non-empty; every entry a non-blank string |
| `name` | string | `Untitled index` | Slug is derived and deduplicated |
| `visibility` | string | `listed` | `listed` or `unlisted` |
| `readPolicy` | string | `open` | `open` or `allowlist` |
| `allowlist` | string[] | `[]` | Wallets, lowercased; the owner is implicit |
| `owner` | string | payer | **Dev mode only**, when the meter is off and there is no payer |

Returns **201** with the status report. Over the cap gives 400 with `pageCap` and `requested`
so a client can retry correctly:

```json
{ "error": "this request covers 1200 pages; the cap is 1000", "pageCap": 1000, "requested": 1200 }
```

The cap exists so a single payment cannot commission a crawl big enough to be impolite to the
sites it targets. Per-host request spacing is what actually keeps a crawl polite, so this is
really a ceiling on what one payment can set off.

Creation takes an explicit URL list rather than a seed host to expand, because the price is
quoted in the 402 and signed for on the retry, so it has to be a pure function of the request
body.

### POST /indexes/:reference/urls

Appends to an existing index. Owner only, checked after verification and before settlement.
Returns the status report merged with what the URLs did:

```json
{
  "id": "e3b69e4e-...", "slug": "account-abstraction", "status": "crawling",
  "pages": 262, "attestations": 0, "pending": 38,
  "joined": 12, "enqueued": 38
}
```

`joined` were already in the document store and became membership rows immediately, with no
crawl. `enqueued` are unknown and were queued for `wuzzy crawl --index=<id>`. This split is
where "crawled once, shared by every index that wants it" actually happens.

### DELETE /indexes/:reference

Owner only. Removes membership and the index row; **the underlying documents are untouched**,
because other indexes may hold them and the provenance trail is append-only regardless.

Deletion is free, so nothing is settled and there is nothing to refund. It still requires a
valid `X-PAYMENT`, purely as a signature proving who is asking.

## Commissioned crawls do not discover

`wuzzy crawl --index=<id>` fetches exactly the URLs that were paid for. Link following would
fetch pages nobody bought and overrun the page cap. Robots is still read and still obeyed,
because paying us cannot confer a right to fetch.

## Attestations never learn that indexes exist

Provenance is a property of the fetch, not of who commissioned it. The attestation schema
carries no index, owner or payer field, guarded by `schemaCarriesNoIndex` the same way
`schemaCarriesNoContent` guards the content invariant. A private index's membership must not
be readable off Base by anyone watching the attester.

## GET /admin/\*

Read-only operations views. Nothing here writes and nothing here computes a hash.

| Path | Query |
| --- | --- |
| `/admin/stats` | |
| `/admin/indexes` | |
| `/admin/documents` | `q`, `host`, `index`, `filter`, `limit`, `offset` |
| `/admin/documents/:id` | |
| `/admin/activity` | `limit`, `filter` |

`filter` on documents is one of `unembedded`, `unattested`, `attested`, `unindexed`, else
`all`. On activity it is `failed`, `skipped`, `changed`, else `all`.

Off unless `ADMIN_ENABLED=true`, and **disabled answers 404 rather than 403**, so a switched
off endpoint does not advertise that it exists. When `ADMIN_TOKEN` is set, requests must carry
it as `x-admin-token` and it is compared with constant-time equality so the check cannot be
turned into an oracle. With no token there is no auth at all, so only leave it unset on
something bound to localhost.

The admin UI is [a separate app](../admin/) with its own origin, image and nginx config, so it
can be kept off the public internet. The public site must never build an admin page.

## GET /healthz

`{"status":"ok"}`. No database round trip, so it reports that the process is up, not that it
is healthy.

## Status codes

| Code | Meaning |
| --- | --- |
| `200` | Fine |
| `201` | Index created |
| `400` | Blank query, malformed `urls`, over the page cap, bad wallet or URL, missing dev-mode `owner` |
| `402` | Payment required, absent, malformed or unmatched. Body carries `accepts` |
| `403` | Verified payer is not permitted to read this index, or not the owner. Never charged |
| `404` | No such index; or a route that is switched off (`/web-search`, `/admin/*`) |
| `401` | `x-admin-token` missing or wrong |
| `429` | `/web-search` rate limit. Carries `Retry-After` |

## Configuration

[.env.example](../../.env.example) is the full list and is commented. The ones that change API
behavior:

| Variable | Default | Effect |
| --- | --- | --- |
| `X402_ENABLED` | `true` | Opt **out**. False opens every metered route and disables allowlists |
| `X402_PRICE` | `$0.01` | Per search query |
| `X402_NETWORK` | `base` | Also `base-sepolia` |
| `X402_PAY_TO` | | Receiving address |
| `WEB_SEARCH_ENABLED` | `false` | Opt **in**. A free route beside a metered one gives the index away |
| `WEB_SEARCH_ORIGINS` | `https://wuzzy.io` | Comma separated CORS allowlist |
| `WEB_SEARCH_RATE_LIMIT` | `10` | Requests per window per client |
| `WEB_SEARCH_PROXY_HOPS` | `1` | Trusted proxies, counted from the right of `X-Forwarded-For` |
| `ADMIN_ENABLED` | `false` | Opt **in** |
| `ADMIN_TOKEN` | | Unset means no auth |
| `SEARCH_MODE` | `hybrid` | Default arm mix. `lexical` needs no embedding provider |
| `SEARCH_CANDIDATES` | `200` | Retrieval window per arm; drives `total` and `exhaustive` |
| `WUZZY_INDEX_PAGE_CAP` | `1000` | Max pages one payment may commission |
| `WUZZY_INDEX_PRICE_PER_PAGE` | `$0.01` | |

The meter is opt-out and the two open surfaces are opt-in, so forgetting to set anything
leaves the index metered and closed rather than given away.

## Where things live

| | |
| --- | --- |
| [src/search/](src/search/) | Hybrid retrieval, RRF fusion, BM25 in SQL, the two controllers |
| [src/indexes/](src/indexes/) | Indexes as a membership view, intake, access policy |
| [src/payment/](src/payment/) | x402 meter, mirroring `x402-express` |
| [src/canonicalize/v1/](src/canonicalize/v1/) | The pinned protocol procedure. Nothing else computes a hash |
| [src/crawl/](src/crawl/) | Crawlee schedules, `http.ts` does every fetch |
| [src/attest/](src/attest/) | EAS batching over `multiAttest`, schema guards |
| [src/admin/](src/admin/) | Read-only operations queries |
| [src/database/migrations/](src/database/migrations/) | Raw SQL. `synchronize` is off everywhere |
| [src/cli/wuzzy.ts](src/cli/wuzzy.ts) | The pipeline commands |

The API surface is specified by [contracts/](../../contracts/), which are the definition of
done. `bun run scenarios` reports coverage per feature file.
