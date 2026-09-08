here's feedback from the agent dogfood trial run below:

Feedback for the Wuzzy devs, from actually commissioning a Base docs index and searching it.

Docs vs product
Local docs 404 /llms.txt and /sitemap.xml. Real pages are /guide/ and /api/. First-load is a SPA 404 if you hit the wrong path.
Published client is npx awal x402 pay. That binary was not here. The thing that actually worked is apps/demo-agent (x402-fetch + viem). Either ship awal or document the demo agent as the customer client.
Index status docs say pending → crawling → ready. In this run, pages climbed 0→362 while status stayed pending and pending stayed 364, then it flipped to ready / pending: 0. The “derived from the queue, cannot disagree” claim did not hold for a live crawl.
Empty search prints no results and returns before printing settlement. You paid; the client looks like a free miss.
Pricing / metering surprises
Quote matched chain: 364 pages = $3.64, each search = $0.01. Transfer amounts on the fork RPC matched the 402 maxAmountRequired exactly. That part is solid.
Empty results still settle. Weather query and a query against empty global both cost a cent. Docs only promise that failed queries are free. “No hits” is a success. For an agent that probes, that adds up, and it is easy to miss because of the client bug above.
Demo --max-spend default $0.10 blocks any real commission unless you raise it after the quote. Fine as a safety rail; easy to think the product is broken.
Commission / crawl
Explicit URL list is the right pricing model. Customer has to fetch the sitemap themselves. No “index this host.” Fine, but say it louder; I would have tried a seed URL first.
364 URLs paid, 362 pages stored. No API to list membership or the two dropouts. Likely https://docs.base.org/mcp (HTTP 405, 83 bytes, under the 80-char reject) and the / 308. Paid-for-and-dropped should be visible on the status report (joined / enqueued exist on append; create has no equivalent failure breakdown).
Crawl of ~362 pages was ~90s. Fine.
Provenance (the actual product)
Search results had real contentHash + fetchedAt. Attestations were all null, as you said.
Independently re-ran v1 (jsdom, Readability, Turndown, NFC/whitespace, sha256) on two live URLs. Both hashes matched. That is the win.
RPC cannot confirm content until a UID exists. Payments I could check on localhost:8545. Fetch claims I could only check against the live web. If provenance is why someone pays instead of using llms.txt, unattested indexes are still “trust the API.” Either attest in the commission path, or make the status report scream that the corpus is not yet checkable onchain.
rawHash is only in the attestation, not in the search provenance block. With UID null, you cannot even compare wire bytes.
Search quality (lexical-only, as configured)
Keyword questions hit the right docs (chain ID 8453, B20 stocks, node snapshots, Denim 200ms, x402).
Ranking is keyword gravity: “chain ID” also pulled Vibenet and wallet_connect RPC pages. Coverage was good; order was not. Do not sell hybrid in the docs while the deployment is lexical-only.
Out-of-corpus queries return empty. No hallucination. Good.
Would I pay again
Yes for a corpus I will query for weeks, at 1¢/page and 1¢/query, once attestations exist.
No for one-off questions. Free llms.txt already answers them, and until UIDs land the paid provenance is an extra hash I have to recompute myself.
Highest-leverage fixes: status actually tracking the crawl, surface dropped URLs, don’t hide settlement on empty hits, document the real client, and close the gap between “provenance you can check on Base” and “hash in JSON, attest later.”
