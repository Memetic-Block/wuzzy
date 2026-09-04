# Wuzzy v2 — Work Breakdown (Sept 2 → Sept 9)

Base Batches application due **Tue Sept 9**. Target submit **Mon Sept 8** with one slack day.
Owner lanes: **[CC]** = Claude Code sessions (implement to contract), **[J]** = Jim-only (keys, mainnet, judgment), **[S]** = Slava/team (tracked in the worksheet, not here).
BDD: Gherkin scenario files live in `contracts/`; each work item's session references its feature file(s), and the item is done when its scenarios pass in CI. Tiers: T1 = spec-first mandatory, T2 = scenario contract, T3 = smoke only.

**Working agreement for Claude Code sessions:** one work item per session where practical, contract file(s) in context; definition of done = scenarios pass + CI green + PR opened from an agent branch (`agents/claude/<n>/<task>`); commits under the agent identity, signed; never push main; funded keys never enter a session, the repo, or the VPS — `@mainnet @manual` scenarios are Jim, by hand.

---

## D0 — Scenario contracts (Day 1 morning, gates everything) [J]

**W0.1 — Canonicalizer conformance vectors (T1)**
`contracts/canonicalize-v1/`: ≥8 fixture pairs (input HTML or MD → expected canonical markdown → expected sha256). Cover: plain docs page, code blocks, nested lists, unicode/NFC case, CRLF input, trailing-whitespace case, thin page, markdown-native source.
✓ AC: vectors committed before any canonicalizer code; README states vectors are published protocol artifacts (third parties build verifiers against them).

**W0.2 — Provenance lifecycle contract (T2)**
`contracts/provenance.md`: scenarios — fresh fetch → documents+fetch_log rows with hashes; re-fetch unchanged → new fetch_log row, document untouched; re-fetch changed → content_hash updated, embedded_at + attestation_uid cleared; verify(url) matches attested hash → exit 0; mismatch → exit 1; unindexed → exit 2.
✓ AC: committed day 1; every D2/D4 task references it.

**W0.3 — Payment contract (T2)**
`contracts/payment.md`: scenarios — no payment → HTTP 402 with x402 requirements body; valid payment → 200 + results, settlement lands at PAY_TO on Base; malformed/insufficient payment → 402; X402_ENABLED=false → open access (dev mode); every 200 result includes provenance block with attestationUid + easscan URL.
✓ AC: committed day 1; doubles as integration doc for the demo agent.

---

## D1 — Repo & CI bootstrap (Day 1) [CC, config J]

**W1.1 — Repo init on Forgejo** — `wuzzy` private; `CLAUDE.md` via /init then hand-edited invariants (honest UA / no stealth; canonicalize v1 frozen after first attestation; hashes-only-onchain; no funded keys in repo/sessions/VPS; agents never touch main; contracts/ features are the definition of done).
✓ AC: main protected (PR-only, no self-approve, signed commits required); mirror to public GitHub reflects main within minutes of merge.

**W1.2 — CI workflow on Forgejo runner** — install, typecheck, scenario tests (excluding @mainnet/@manual tags).
✓ AC: green run on a trivial PR authored by Claude Code under the agent identity, end-to-end (the green-light gate). *Note: existing `mb-dev-hermes-claude` account/token/signing key carry over as-is — optionally rename the account's harness segment to match Claude Code; cosmetic, not blocking.*

**W1.3 — Compose + schema** — pgvector service, schema.sql auto-applied.
✓ AC: `docker compose up` → psql shows documents/fetch_log/chunks with hnsw index.

## D2 — Provable crawl pipeline (Days 1–2) [CC; seeds J]

**W2.1 — Canonicalizer v1 (T1)** — implement to W0.1 vectors; PROTOCOL/VERSION constants; module documented as frozen-once-attested.
✓ AC: all vectors pass in CI; no other module computes hashes.

**W2.2 — Crawler** — Crawlee, honest UA, robots→sitemaps→same-host queue, thin-page filter, provenance writes per W0.2, re-crawl invalidation logic.
✓ AC: W0.2 fetch scenarios pass (mock server fixtures); full crawl of seeds completes without manual intervention; fetch_log row for every fetch.

**W2.3 — Seeds curation [J]** — final seeds.json (docs.base.org, CDP/x402 docs, blog, + picks); spot-check ≥15 extracted pages for quality.
✓ AC: ≥3k documents indexed-quality corpus, or consciously accepted smaller.

## D3 — Index & search (Days 2–3) [CC; quality judgment J]

**W3.1 — Embed pass** — chunker + OpenAI-compatible embedder, restartable, embedded_at bookkeeping.
✓ AC: re-run is a no-op on unchanged corpus; changed doc re-embeds (per W0.2).

**W3.2 — /search** — vector topK joined to documents; response shape per W0.3 provenance block.
✓ AC: T3 smoke — 10 canned Base-ecosystem queries return sane top-3 (Jim eyeball); p95 latency < 1.5s local.

**W3.3 — Freeze v1 [J]** — final review of canonicalizer; VERIFY.md finalized to match implementation exactly.
✓ AC: VERIFY.md + vectors + code agree; freeze noted in AGENTS.md.

## D4 — Onchain provenance (Day 4) [J keys/tx; CC code]

**W4.1 — Schema registration [J]** — attester wallet (gas-dust only, VPS never holds it), register on Base mainnet.
✓ AC: schema UID visible on base.easscan.org; in .env.

**W4.2 — Batch attestor [CC code, J run]** — multiAttest batches, UID backfill, idempotent.
✓ AC: full corpus attested; spot-check 5 UIDs decode correctly on easscan; re-run attests only new/changed docs.

**W4.3 — verify CLI (T2)** — implements W0.2 verify scenarios.
✓ AC: exit codes per contract; MATCH on 5 random indexed URLs; MISMATCH demonstrated on a mutated fixture.

## D5 — Meter & demo agent (Days 5–6) [J wallets/listing; CC code]

**W5.1 — x402 meter [CC code, J config]** — adapter verified against current x402 docs, mainnet config, PAY_TO fresh address.
✓ AC: W0.3 scenarios pass against mainnet (one real paid query settles; Basescan link recorded).

**W5.2 — Demo agent repo [CC]** — public GitHub-native `wuzzy-demo-agent`: x402-fetch client, fresh wallet flow, README as quickstart.
✓ AC: clean-machine run: fund fresh wallet → pay → results with attestation UIDs printed; recorded as asciinema.

**W5.3 — Bazaar listing [J]**
✓ AC: Wuzzy discoverable on the x402 Bazaar (cuttable to post-submit if blocked).

## D6 — Evidence pack (Days 6–7) [J + S]

**W6.1 — Video** — 2-min: 402→pay→results→easscan→Basescan loop + why-us beats (script in worksheet; Slava edits).

**W6.2 — Numbers** — paid queries, wallets, docs attested, Basescan/easscan/schema links → worksheet traction + Dune-lite (optional).

**W6.3 — Submit Mon Sept 8.**
✓ AC: every claim in the application true-on-submission; demo URL live; mirror public with 7 days of history.

---

## Descope ladder (pre-agreed, cut top-down if slipping)
1. Bazaar listing → post-submit
2. Corpus size → docs.base.org only
3. Search quality niceties (reranking, snippet polish)
4. Video → screen-recording with captions, no edit pass
**Never cut:** honest-crawler invariants, canonicalizer vectors passing, EAS attestations on mainnet, x402 meter on mainnet, one real settled paid query.

## Jim-only critical path (schedule around these)
Day 1: contracts (W0.*), seeds. Day 3: freeze + VERIFY.md. Day 4: wallets + mainnet registration/attest runs. Day 5: meter config + paid-query test. Day 6–7: video + submission. Everything else is reviewable-PR work.
