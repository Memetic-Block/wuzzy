# Wuzzy — Configurable Indexes (D7)

*Design doc, Sept 2026 (rev 2 — use-case-agnostic framing). Stretch deliverable: starts only after D4 (mainnet attestations) and D5 (mainnet meter + one real settled paid query) are green. Companion to the work breakdown and BDD contracts docs.*

## The primitive

Every index is the same object, configured differently. "Global" is not special — it is an index owned by the Wuzzy operator wallet with public settings. The Base-docs index already running is index #1. The primitive is use-case-agnostic: what an index is *for* is the owner's business, expressed entirely through configuration.

Config axes (MVP values marked):

| Axis | Values | MVP |
| --- | --- | --- |
| owner | creating wallet (operator wallet for globals) | ✓ |
| visibility | `listed` (in public catalog) / `unlisted` | ✓ |
| read_policy | `open` (any payer) / `allowlist` (owner + listed wallets) | ✓ |
| read_payment | flat per-query x402 price to Wuzzy, owners included | ✓ MVP — owner-set pricing with revenue to owner = the tenant merchant-inversion tier, roadmap |
| write_policy | owner-only appends | ✓ (collaborative indexes later) |

## Usage patterns (lenses, not features)

None of these exist in the code — they are configurations of the same primitive, and marketing lenses for different audiences:

- **Commissioned research index** — one-shot: pay, crawl a topic's sources, query it. Public or private.
- **Private working set / agent memory** — unlisted + allowlist + append-heavy: an agent's persistent, queryable record of what it has read, keyed to a wallet rather than a platform account. ("What did I read about X?" — with receipts.)
- **Tenant / site index** — a project's own content, agent-queryable; grows into the merchant-inversion tier where the tenant owns endpoint revenue.
- **Curated public catalog** — listed + open: a maintained, provenance-backed reading list anyone can pay to query.
- **Team knowledge base** — allowlist of several wallets over a shared corpus.

Development never targets a lens. If a proposed change only makes sense for one of these, it's probably not a primitive-level change.

## Architecture: views, not silos

- One shared document store. An `indexes` table + index-membership join table.
- Index creation enqueues crawls only for URLs not already in the store — same URL wanted by two indexes crawls once, dedup for free.
- `/search` takes an optional index scope; unscoped defaults to the global index, so all existing contract scenarios stay green.
- **Attestations are unchanged and unaware of indexes.** Provenance is a property of the fetch, not the index. The frozen schema never learns indexes exist.
- Appending is a primitive capability (owner adds URLs over time, paying per new page); one-shot indexes simply never use it.
- Pricing: x402-metered creation, per-page (e.g. $0.01/page, capped at a few hundred pages v0). First revenue line beyond queries.

## Auth: x402 is the signature

A valid x402 payment cryptographically proves control of the payer wallet, so allowlist enforcement rides the payment — no second auth mechanism for MVP.

Flow subtlety that makes rejection free: the initial 402-with-requirements goes to anyone (payer unknown at that point); the allowlist check runs on the paid retry after payment verification but **before settlement** — a non-allowlisted wallet gets 403 and is never charged. Verify-then-settle.

Signed-but-unpaid reads become necessary only when free reads for allowlisted wallets are wanted (owner querying own index gratis, partner access). Deferred exactly that far.

## Claim language & privacy rails (apply to every lens)

1. **"Onchain index/memory" overclaims today.** Onchain now: provenance attestations on Base. Embeddings, membership, recall: our Postgres. Accurate phrase: **"wallet-keyed indexes with onchain provenance."** Fully "onchain" only when the Arweave archive tier ships (which also upgrades exit rights: indexes rebuildable from permanent public data if Wuzzy vanishes).
2. **Private hides curation, not crawling.** Every fetch is publicly attested with the URL in cleartext. Structural mitigation already present: attestations are signed by Wuzzy's attester and deduped across indexes — nothing links a URL to the requesting wallet *in aggregate*. But a unique/obscure URL that exists in the corpus only because one wallet asked is inferable, and timing correlation helps an observer. A private index's contents can be sensitive metadata (a trading agent's reading list is alpha). Documented plainly in MVP — it is a tested contract scenario — and properly fixed on the roadmap.

## Roadmap items this creates (named so they don't creep into MVP)

- **Hashed-URL attestation option:** attest a salted hash of the URL instead of cleartext. Provenance stays disputable by anyone who knows the URL (reveal salt + URL, recompute); invisible otherwise. Protocol-level change (schema variant / v2 consideration). Pairs with the encrypted-archive tier — together: *private indexes with provable contents.*
- **Direct content submission** (owner stores content they have rights to — notes, drafts, tenant material): different provenance semantics — "submitted-by-wallet" is a separate schema. Phase 2.
- **Owner-set read pricing with revenue to owner** — the tenant merchant-inversion tier.
- **MCP wrapper** exposing index append/query to any agent harness. Small, demo-able. Program phase.
- **Collaborative write policies.**

## Contract: contracts/indexes.feature (additive; existing three features unchanged)

```gherkin
@t2 @indexes
Feature: configurable indexes
  Every index is the same primitive, configured differently. "Global" indexes
  are owned by the Wuzzy operator wallet with visibility=listed and
  read_policy=open. Agents create their own via x402 payment, configure
  access, and query them through the same metered /search. The primitive is
  use-case-agnostic: research corpora, private working sets, tenant sites,
  and curated catalogs are configurations, not features. Provenance is a
  property of the FETCH, not the index: attestations are shared, public, and
  unchanged by index membership.

  Background:
    Given the API is running with the global index populated
    And the meter is enabled

  Scenario: unscoped search targets the global index
    When a client pays for /search without an index parameter
    Then results come from the global index only

  Scenario: agent commissions an index
    When a wallet pays the index-creation price for seeds it supplies within the page cap
    Then an index is created with that wallet as owner
    And crawl jobs are enqueued only for URLs not already in the document store
    And the response includes the index id and a status endpoint

  Scenario: index creation respects the page cap
    When a wallet requests index creation whose seeds expand beyond the page cap
    Then creation is rejected before payment is settled
    And the response states the cap

  Scenario: shared documents are crawled and attested once
    Given a URL already in the document store with an attestation
    When a new index includes that URL
    Then no re-crawl occurs
    And the existing attestation uid is served for it in both indexes

  Scenario: index status reaches ready
    Given a newly commissioned index
    When its enqueued crawls complete
    Then the status endpoint reports ready with page and attestation counts

  Scenario: scoped search returns only member documents
    Given a ready index owned by wallet A
    When wallet A pays for /search scoped to that index
    Then every result's document is a member of that index
    And each result carries its provenance block and attestation uid

  Scenario: allowlist read policy admits listed wallets
    Given a ready index with read_policy allowlist including wallet B
    When wallet B pays for /search scoped to that index
    Then the response status is 200

  Scenario: allowlist read policy rejects unlisted wallets before settlement
    Given a ready index with read_policy allowlist not including wallet C
    When wallet C submits payment for /search scoped to that index
    Then the response status is 403
    And wallet C's payment is not settled

  Scenario: unlisted indexes do not appear in the catalog
    Given an index with visibility unlisted
    When a client fetches the public index catalog
    Then that index is absent
    But the global index is present

  Scenario: private index of public content hides curation, not crawling
    Given an allowlist index containing publicly crawled URLs
    Then those URLs' attestations remain publicly visible on Base
    And the index's existence, membership, and queryability are not derivable from attestations

  Scenario: owner appends to their index over time
    Given a ready index owned by wallet A
    When wallet A pays to append URLs within the page cap
    Then URLs not already in the document store are enqueued for crawling
    And already-stored URLs join the index immediately with their existing attestations
    And the appended pages become searchable in that index once crawled

  Scenario: only the owner may append
    Given a ready index owned by wallet A
    When wallet D submits payment to append URLs to it
    Then the response status is 403
    And wallet D's payment is not settled

  Scenario: deleting an index removes membership only
    Given a ready index whose owner requests deletion
    Then the index and its membership rows are removed
    And no documents or attestations are deleted
```

## Seed expansion for the global index (separate from D7, do anytime)

Tier 1 — reviewers query their own world: docs.cdp.coinbase.com (x402/AgentKit/onramp), docs.attest.org (EAS — self-referentially good), docs.optimism.io, viem.sh, wagmi.sh, docs.farcaster.xyz, docs.zora.co.
Tier 2 — the agent-developer's bookshelf: eips.ethereum.org (ERC-8004 queries), docs.openzeppelin.com, book.getfoundry.sh, docs.soliditylang.org, developers.circle.com, Virtuals docs.
Tier 3 — strategic garnish: Sibyl Labs docs (design-partner gesture); optional small ao/HyperBEAM slice as territory teaser — keep the corpus ≥90% Base/EVM so the Base-first read stays clean.
Rough size: +15–30k pages; check crawl politeness budgets and embedding spend.

## Demo & application impact

- Video gains a second beat after the receipts loop: an agent pays to commission its own index, appends to it, and a second wallet is locked out. Narrate it through whichever lens fits the audience — research corpus, private working set — the footage is identical.
- Application vision copy, one sentence: "Indexes are configurable primitives — the public index we operate, and indexes agents commission for themselves: public or private, one-shot or growing, from research corpora to persistent private working sets."
- Gate unchanged: D4/D5 green on mainnet before any D7 work. The never-cut list is untouched by this feature existing or not.
