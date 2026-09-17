# Improvements to make after MVP

Things found while dogfooding that are understood, reproducible, and deliberately not being
fixed yet. Each one says what it costs to leave alone, so the decision to defer stays a
decision rather than a thing nobody got round to.

Client feedback from the runs themselves is in [dogfood/](dogfood/). This file is only what we
triaged out of it, plus what we found ourselves while setting the runs up.

## Attestation progress is invisible while it happens

The attester writes in `multiAttest` batches of 50 and
[attest.processor.ts](../apps/backend/src/queue/attest.processor.ts) logs once, after
`attestPending` returns. A 354-page index is eight batches, so the process says nothing at all
for the whole run and then reports everything at the end. Meanwhile
[attest.sweeper.ts](../apps/backend/src/queue/attest.sweeper.ts) prints
`swept 1 index(es) awaiting attestation` every minute. That is correct behavior, because the
sweeper re-enqueues under a deterministic job id and BullMQ dedupes against the job already
running, but it reads exactly like a retry loop failing over and over.

From the buyer's seat it is worse, because the number is the product. The second dogfood client
paid for 354 receipts, watched the index go `ready` with `attestations: 0`, and had nothing in
the status payload telling it whether receipts were coming or had silently failed. Its own
words: it felt like paying for a receipt that had not been written yet, with no ETA.

This is the same shape as the crawl status that sat frozen at `pending` for the length of a
run, which we fixed by retiring `index_urls` rows as each page landed. A counter that does not
move is read as a counter that is broken.

Three things would settle it, in rising order of effort: log per batch rather than per run;
quieten the sweeper when every index it finds is already being worked; and give the status
payload a way to say receipts are queued, so a client can tell "not attested yet" from
"attestation is not coming". The last one is the one the customer actually asked for.

Not urgent for the demo because the fork exaggerates it. Fork RPC fetches state from upstream on
first touch, so batches there take far longer than the same work on Base. The slowness is an
artifact; the silence is not, and on mainnet a large commissioned index would go quiet for a
long stretch with real money already spent.

## Redirects collapse, and the payer absorbs it

We bill per requested URL, and two requested URLs that redirect to the same destination produce
one document. Found in preflight on 2026-09-08: commissioning `https://docs.base.org/`,
`/get-started/base` and `/base-chain/quickstart/why-base` charged for three pages and produced
two documents, because `/` 308s to `/get-started/base`, which was also asked for by name, and
`/base-chain/quickstart/why-base` 308s to `/specifications/overview`.

Nothing failed. All three URLs were fetched, 200, no error, and the queue rows retired
correctly. The index then reports `pages 2, pending 0, failed 0, status ready`, so the shortfall
is invisible: the customer paid for three, received two, and nothing anywhere accounts for the
difference. It gets likelier the larger the commission, and a sitemap-driven crawl of a site
that has reorganized is exactly where it bites.

The crawl is right; the reporting is not. Three ways out, and the choice is a product one rather
than a technical one: report the collapse honestly and let the payer see it, credit the
difference back, or crawl a replacement page. Reporting is the cheap one and the honest floor,
since the current state is silent under-delivery.

## The demo stack cannot attest at all

[compose.demo.yml](../compose.demo.yml) has no attester service, so a commission there enqueues
an attestation job that nothing drains and the index shows no receipts forever. That is
consistent with what the demo stack is (no chain, no funds, a facilitator that settles nothing),
but it now contradicts the product claim that every page bought carries a receipt, and anyone
demoing from that stack will be showing an index with `attestations: 0`.

Either run an attester there against a local chain, or have the demo stack say plainly that
receipts are the one part it stands in for. The fork rig in [scripts/fork/](../scripts/fork/) is
the one that attests for real, and it should stay the thing we point at for proof.
