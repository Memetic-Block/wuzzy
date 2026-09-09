Payer: 0xe2F5810fB874f0C9E6377231f67015f2827d6F59 Index: memeticblock-com-smoke (bd691107-0126-430b-ba7f-30f723f615cf), unlisted, 9/9 pages, 0 failed Total spent: $0.20 (wallet 22.35468 → 22.15470 USDC)

Cost
Stage
Quoted
On-chain USDC transfer
Tx
Index 9 sitemap URLs	$0.18	$0.1800 from this wallet to 0x0Deb…EAcB	0x4ff0…f6d4
Search (Anyone Protocol)	$0.01	$0.0100	0x7c10…c2cf
Search (BTC price)	$0.01	$0.0100	0x7634…ae12
All three receipts are USDC transferWithAuthorization on Base, submitted by facilitator EOAs, not by us. No ETH was needed.

The search client’s immediate balanceOf still showed \$0 spent; the chain was the source of truth a few seconds later.

Timing / status
Stage
Wall time
What status said
Unpaid quote	366ms	402, \$0.18, 9 pages
Paid commission	1.3s → 201	pending, pages=0, pending=9
Crawl	5.3s to ready	pages=9, pending=0, failed=0
Search 1	quote 169ms, paid 1.6s	8 hits, exhaustive: true
Search 2	quote 316ms, paid 1.6s	8 hits anyway
Status was enough to know the crawl finished. It was not enough to know when provenance would be onchain: ready with attestations=0, and it was still 0 minutes later. Every result still has attestationUid: null.

Searches
Unplanned: “What did Memetic Block build for Anyone Protocol?” Top hit is the case study. Snippet: core engineering arm, three years, full stack from token to production. That sentence is in the live HTML I fetched myself. Not invented.

Expected-bad: “What is the current Bitcoin price in USD?” It does not say “unknown” and it does not invent a price. It still returns eight marketing pages (services, contact, about…). Retrieval, not QA. You pay $0.01 for a ranked miss.

Provenance vs Base
Checked against Base, not the API’s word:

Payments: real. Amounts, payer, and payTo match the 402 quotes.
Crawl attestations: not on Base yet. No uid, nothing to getAttestation on 0x4200…0021.
rawHash: does not match a live refetch. Same URL, 22437 bytes, three UAs, three different SHA-256s — Cloudflare HTML jitter. That is exactly the case contentHash is for, and I could not reproduce the v1 canonicalization here (jsdom + Readability + Turndown) in this pass.
Snippet: grounded in the current page text.
So what a receipt buys you today on this run is a payment receipt, not a crawl receipt. Recomputing a hash yourself still isn’t possible until they write the EAS uid. A free llms.txt would have answered the Anyone question for $0 — this site doesn’t have one — but it also wouldn’t give you an onchain fetchedAt. Right now neither does Wuzzy, for this index.

Docs I had to guess
Docs package (@x402/fetch + ExactEvmSchemeV1, network: 'base', x402Version: 1) worked once the wallet had USDC. Empty-wallet failure was invalid_payload, not insufficient_funds.
Demo default URL is still https://wuzzy.io/search; live meter is https://api.wuzzy.io.
ready ≠ attested. Docs mention the counters; they don’t say how long the uid lag is, or that search will happily sell unattested results.
hasMore: true with exhaustive: true and total: 9 / topK: 8 is a paging oddity. I did not pay a third query to chase it.
spendControls must be set above the per-page quote. Demo default \$0.10 would have blocked this \$0.18 commission.
Would I spend my own money again?
$0.20, yes, as a meter/handshake smoke. The 402 → EIP-3009 → Base USDC path is real and fast.

Not yet for provenance. I paid for “every result carries an onchain receipt.” I got hashes in JSON and a null uid. I’d spend another cent after they attest, specifically to decode the EAS blob and see if contentHash / fetchedAt survive a Cloudflare-varying rawHash. Until that lands, you’re buying crawl-and-search, and the receipt is only for the USDC.
