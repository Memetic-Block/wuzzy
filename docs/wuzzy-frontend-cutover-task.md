# Frontend Task — wuzzy.io v2 Cutover (D8)

*Scoped for a Claude Code session in the wuzzy monorepo. Runs **fully parallel** to the remaining backend work (D4/D5 keys-and-chain, which is human-only) — see "Parallelism contract" below for the two integration points and their fallbacks. Deadline context: site must be cutover-ready before the Base Batches submission Mon Sept 8; DNS cutover itself is a human step.*

## Mission

Replace the legacy wuzzy.io (ArNS/Goldsky-era, deprecated architecture) by building out `apps/frontend` in this monorepo as the new public site. Port the **brand** forward from the old site; port **none** of its architecture, data plumbing, or search wiring. The homepage's job: make the application's claims concrete — positioning, an agent quickstart, and receipt links a reviewer can click.

## Inputs you have

- `docs/wuzzy-v2-work-breakdown.md` — positioning one-liner, invariants, context
- `docs/wuzzy-bdd-contracts.md` — the 402 flow the quickstart must depict accurately
- **Legacy site source: https://github.com/Memetic-Block/wuzzy-site — already checked out locally (ask Jim for the path if not obvious).** This is the source of truth for brand assets (logo, colors, typography, favicon) and the privacy/terms page text. Port brand and legal text FROM it; port no architecture, components, data plumbing, or search wiring — it is reference material, not a migration source.
- Legacy privacy policy + terms pages — extract from wuzzy-site per P2

## Work items, in priority order

### P1 — Brand port into the template frontend
- Map legacy logo/colors/type onto the template's Tailwind tokens; favicon + og-image.
- Static HTML output per the template's existing build (no new framework, no SPA).
- AC: `bun run build` for the frontend produces the styled static site; brand visually matches legacy wuzzy.io (Jim eyeballs).

### P2 — Legal pages carried over
- `/privacy` and `/terms` as static pages from the provided legacy text.
- Strip any passages describing legacy data practices (ArNS resolution, Goldsky/GraphQL querying, wallet-connection features that no longer exist). Do not author new legal language — removal only; flag anything ambiguous for Jim instead of rewriting it. (Full legal refresh is post-deadline, out of scope.)
- AC: both pages build and are linked in the footer; a grep for ArNS/Goldsky/GraphQL over the legal pages returns nothing.

### P3 — Homepage
Single page, in this order:
1. **Hero:** the one-liner from the work breakdown doc + one sentence of support. No carousel, no animation work.
2. **Agent quickstart:** a copy-pasteable code block showing the real flow against `https://api.wuzzy.io/search` — request → HTTP 402 with payment requirements → paid retry → results with provenance block. Use the exact response field names from the payment contract (`provenance.contentHash`, `provenance.attestationUid`, `provenance.attestationUrl`). Show both a raw curl depiction of the 402 handshake and a one-command client example (e.g. `npx awal x402 pay …`).
3. **Receipts row:** links to — GitHub repo, `VERIFY.md`, the EAS schema on base.easscan.org, the x402 Bazaar listing. Render from a single config file (`site.config.ts`) so values drop in without touching markup.
4. **How-it-verifies strip (3 short items):** honest crawler (UA + robots + honor-or-skip) → attested fetch (hash on Base, versioned protocol) → replay it yourself (`wuzzy verify <url>` / VERIFY.md link). Copy tone: factual, no hype adjectives.
5. **Footer:** privacy, terms, contact.
- AC: builds statically; every external link comes from `site.config.ts`; page reads correctly with placeholder config values present.

### P4 — Free human search box (build behind a flag; cuttable)
- A search input on the homepage posting to a **free, rate-limited** route — `/web-search` on the backend (NOT the metered `/search`; the payment contract's scenarios must remain untouched).
- Backend half of this item: add `/web-search` — same query path as `/search`, no x402, IP rate-limited (modest, e.g. 10/min), same response shape including provenance blocks, `Cache-Control` friendly.
- Frontend renders results with title, snippet, URL, and a visible attestation link per result — the receipt IS the feature.
- Feature-flagged via `site.config.ts` (`searchEnabled: false` default) so the site ships with or without it.
- AC: with the flag on and a local backend, a query returns rendered results with working easscan links; with the flag off, no search UI renders and the page is complete without it.

### P5 — Deploy readiness
- Frontend image builds in CI as already configured; document (README section) the env/serving assumptions: site at `wuzzy.io`, API at `api.wuzzy.io`, CORS on `/web-search` restricted to the site origin.
- AC: CI green; a `podman compose up` local run serves the site container.

## Parallelism contract (why this doesn't block on backend)

Only two values from the backend/chain work land here, both via `site.config.ts` placeholders until they exist:
1. EAS schema URL (from D4 registration) — receipts row link
2. Bazaar listing URL (from D5) — receipts row link

Everything else is buildable now. P4's backend route touches no metered path and no contract scenario, so it can merge independently of D4/D5. If the flag decision is unresolved at cutover, ship with `searchEnabled: false` — the site is complete without it (the agent quickstart is the core evidence; the search box is garnish).

## Out of scope (do not build)

- Index catalog / D7 UI of any kind
- Wallet-connect, account, or dashboard features
- Blog, docs site, or CMS
- New legal language
- Any dependency on ArNS, Goldsky, or GraphQL
- Changes to `contracts/*.feature` (nothing here needs one)

## Invariants (inherit from CLAUDE.md; restated because a helpful session will be tempted)

- No route or UI ever serves stored third-party document content wholesale — snippets in search results only. Metadata + links are fine.
- The quickstart shows real prices/flows only; if the query price env differs from copy, read it from config, never hardcode a stale number.
- Work on an `agents/claude/<n>/frontend-cutover` branch → PR; never push main.

## Human steps (Jim, not this session — listed so the session doesn't attempt them)

- Point the session at the local wuzzy-site checkout path if it can't find it
- Lower wuzzy.io DNS TTL now; cut DNS to the new frontend + api.wuzzy.io after review
- Fill real `site.config.ts` values as D4/D5 produce them
- Final copy review with Slava
