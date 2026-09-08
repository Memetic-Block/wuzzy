# Recording the commissioning demo

The story: an agent arrives, finds nothing indexed, is quoted a price, pays it, and ends up
searching an index it owns where every result carries an onchain receipt. All of it against a
forked Base mainnet, so nothing costs anything and the loop is otherwise real.

Bring the stack up with [README.md](README.md) first. This is the shot list and what each step
actually takes, measured on a 40-page rehearsal.

## Timings, measured

All of docs.base.org, 354 pages, from an empty database:

| Step | Time | Result |
| --- | --- | --- |
| `demo indexes` | instant | one empty global index |
| `demo commission` | 0.5s | **$3.54**, settled, 354 pending |
| `wuzzy crawl --index=` | **1m37s** | 354 indexed, 0 failed, 220 pages/min |
| `wuzzy embed` | 5.9s | 2,436 chunks |
| `wuzzy attest` | **12m22s** | 8 batches, and see below |
| `demo search --index=` | 0.4s | every result carries a receipt |

The crawl films uncut: the whole of Base's documentation in under two minutes is the shot.

**Attestation is the one step that cannot be filmed live, and the fork is why.** A forked node
fetches state from upstream the first time it touches it, and that dominates: a warm batch of
50 still takes about 1m45s here, against seconds on real Base. Attest off camera, or cut away.
Do not present this number as the product's.

## Why not the full 4,555-page corpus

The existing demo corpus spans seven hosts and was built by a *discovering* crawl. A
commissioned crawl deliberately does not discover: it fetches exactly the pages that were paid
for, so the agent has to name them, and the only honest source for that list is each site's
sitemap. Those do not add up:

| Host | In the corpus | In its sitemap |
| --- | --- | --- |
| docs.cdp.coinbase.com | 2,379 | 2,357 |
| viem.sh | 640 | 642 |
| wagmi.sh | 530 | **3** |
| docs.base.org | 467 | 354 |
| docs.optimism.io | 433 | 408 |
| docs.farcaster.xyz | 81 | 5 |
| docs.zora.co | 25 | **0** |

Two of them barely publish one. Beyond that, `WUZZY_INDEX_PAGE_CAP` is 1,000, so a single
commission of 4,555 pages is refused by design, and attesting that many on a fork would take
hours.

docs.base.org alone is the right scope for a recording: one host, a complete sitemap, a real
price, and a crawl that finishes while the viewer is still watching.

## Shot list

**1. Nothing here yet.** Costs nothing and needs no wallet, which is worth saying out loud.

    bun apps/demo-agent/src/main.ts indexes

Shows one empty global index. That is the "no indexes yet" beat.

**2. Ask the price without paying.** The agent quotes before it signs.

    bun apps/demo-agent/src/main.ts commission --name="Base ecosystem docs" $(cat urls.txt)

With the default ceiling this refuses, on purpose, and says what it would have cost and how to
approve it. It is a good beat: the client will not spend more than it was told to.

    quoted    $3.54 on base
    that is above the $0.10 ceiling for this command.
    re-run with --max-spend=3.54 to approve it.

**3. Approve and pay.** One x402 payment, settled onchain, and an index the agent owns.

    bun apps/demo-agent/src/main.ts commission --name="Base ecosystem docs" \
      --max-spend=3.54 $(cat urls.txt)

**4. The crawl runs.** Operator side; the agent has already been told where to watch.

    bun apps/backend/src/cli/wuzzy.ts crawl --index=base-ecosystem-docs
    bun apps/backend/src/cli/wuzzy.ts embed

**5. Attest.** See the timing note above.

**6. Watch it fill, then search it.**

    bun apps/demo-agent/src/main.ts status base-ecosystem-docs
    bun apps/demo-agent/src/main.ts search --index=base-ecosystem-docs "how do I batch calls"

Status ends on `proof  354 of 354 attested onchain`, and every search result carries a content
hash and an attestation link. That is the whole argument in two screens.

## The URL list

A commissioned crawl does not discover: it fetches exactly the pages that were paid for, so the
agent has to say which. Taking them from the site's own sitemap is the honest version of that
and reads well on camera:

    curl -s https://docs.base.org/sitemap.xml \
      | grep -oE 'https://docs\.base\.org[^< ]*' | sort -u > urls.txt

## Two things to decide before recording

**Embeddings.** The rehearsal used `scripts/demo/stub-embeddings.ts`, which is a hashed bag of
words and says so in its own header. It does not make any attestation untrue, because an
attestation covers the URL and the content hashes and nothing about a vector. But it does make
vector retrieval meaningless, which is why the rehearsal ran `SEARCH_MODE=lexical`. If a real
embedding key is available, use it and let the hybrid ranking be real. If not, stay lexical and
do not claim hybrid on camera.

**Explorer links.** Results link to `base.easscan.org` and `basescan.org`, and neither resolves
a fork-only transaction. Either avoid clicking them, or verify against the RPC instead:

    cast call 0x4200000000000000000000000000000000000021 \
      "getAttestation(bytes32)((bytes32,bytes32,uint64,uint64,uint64,bytes32,address,address,bool,bytes))" \
      <uid> --rpc-url http://localhost:8545

## Resetting between takes

    podman exec wuzzy-postgres-1 psql -U app -d postgres \
      -c "DROP DATABASE IF EXISTS wuzzy_demo;" -c "CREATE DATABASE wuzzy_demo OWNER app;"
    cd apps/backend && POSTGRES_DB=wuzzy_demo bun run migration:run

Then re-run `bun scripts/fork/setup.ts` for a fresh funded wallet. A new wallet each take also
avoids reusing a spent EIP-3009 authorization, which would fail on the second attempt.
