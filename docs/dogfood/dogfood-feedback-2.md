Feedback from a first-time paying client on the local fork: one wallet, local docs (:4000), API (:3002), RPC (:8545). Client used: in-repo apps/demo-agent (bun run demo). I did not write a client.

What worked
x402 as the only credential is real. Unpaid POST /indexes quoted \$7.08 for 354 URLs; the signed retry settled that exact amount. Same for search at \$0.01. On the fork RPC, USDC Transfer data matched maxAmountRequired every time. Facilitator submitted; payer needed USDC, not ETH.

The demo agent’s ceiling is the right failure mode. Default --max-spend is \$0.10. It printed the quote, refused, and told me the flag to approve \$7.08. Nothing was taken.

No host expansion is the correct pricing model. I pulled https://docs.base.org/sitemap.xml (354 HTML URLs, no images, no llms-full.txt), commissioned that list, crawl finished in about two minutes, failed: 0. Status (pending → crawling → ready) tracked the queue.

contentHash is the claim that holds. Independent v1 script (jsdom, Readability, Turndown; not operator code) matched three hits I actually used. rawHash moved with the HTTP client; contentHash did not. That is the two-hash story doing its job.

Unscoped search is global, not “everything.” Empty global still charged a cent and said so. I would have been angry if it had been silent.

Docs vs the machine in front of me
Local docs sitemap and llms.txt point at https://localhost:5173. The server is :4000. /guide/ and /api/ are the real pages. A customer who only follows those two files will commission the wrong origin or conclude there are no docs.

Demo output and API examples send you to basescan.org / base.easscan.org. On a private fork those URLs 404. The tx and the USDC transfer are on the RPC you already have. A one-liner (“if the explorer is empty, eth_getTransactionReceipt”) would have saved a loop. The product already knows this fork exists.

Search --max-spend is parsed for commission/append and ignored for search (hard DEFAULT_MAX_VALUE of \$0.10). I passed the flag on search and it did nothing. Either honor it or reject unknown flags.

GET /indexes/:id failures[] is the right shape. I got an empty list and 354/354 pages. Keep it; that is how you defend “you paid for these URL slots.”

Ranking and empty results (lexical-only)
Judge coverage, not order, as advertised. Still:

“restrict eligible holders B20 allowlist” put the exact title page at #7. Neighbors were related, so coverage was fine. An agent that takes top-1 would have the wrong page.
“Solana rust cargo build-sbf…” did not invent a fake guide. It returned the Base–Solana bridge. Keyword overlap, not hallucination.
“postgresql vacuum freeze xid wraparound” against base-docs was not empty. BM25 grabbed “freeze” in B20. I paid a cent for that.
The meter rule is: zero hits is a successful query. In lexical-only on a 354-page English corpus, true zero is rare unless the query has no overlapping tokens (global empty worked). Agents will burn cents on “should miss” probes. Worth saying in the search notes: under lexical, expect keyword collisions, not empty sets.

Response mode is documented as the way to see what actually ran. The demo client never prints it. If the deployment is lexical-only, the client should say so on every result, or people will blame ranking on the corpus.

Attestations
Paid \$7.08 for crawl + embed + onchain receipt. Index went ready at 354 pages with attestations: 0. Still 0 after several minutes and several searches. Searchable without a uid is a documented state. From a buyer’s seat it feels like I paid for a receipt that had not been written yet, with no ETA on the status payload.

Until a uid exists I can recompute contentHash. I cannot getAttestation. Status could show attestations vs pages plus something like “receipts are queued,” so I do not poll easscan for a thing that is not there.

Pricing surprises (small)
\$0.02/page and \$0.01/query were clear once I saw a 402. I only knew the per-page number after quoting a full body. A public GET of the rate (or the 402 description already saying “354 page(s)”) is enough; the description was good.

I would spend this again for a sitemap I chose. I would not let an agent spray queries to “see if it’s empty” on a lexical index.

Client / integration nits
--endpoint accepts API base or /search. That is good. Default is still https://wuzzy.io/search in the client and https://api.wuzzy.io in the docs. Pick one in both places.
Commissioning 354 URLs as argv worked. A @urls.txt / --urls-file would be the grown-up path past a few dozen pages.
X-PAYMENT-RESPONSE settlement hash is the right handle. Printing a basescan URL as the only form of it trains people to trust an explorer this environment does not have.
Would ship this to an agent
Yes, with three sentences in the client or the quickstart:

You bring the URL list; sitemap is your job; quote then raise --max-spend.
Lexical deployments collide on shared words; total/empty are not a relevance signal.
Pages can be searchable before they are attested; verify contentHash yourself; check USDC on RPC if the explorer is blank.
Nothing here stopped the job. The gaps are trust-timing (receipts), ranking honesty in the client, and local docs pointing at the wrong host.
