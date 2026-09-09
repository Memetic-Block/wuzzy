# Prompt: first paid run on Base mainnet

A small, real-money smoke test of the whole loop. Paste the block below to the agent, with the
key filled in. The general brief is [briefing-mainnet.md](briefing-mainnet.md); this is the
short version aimed at one site.

---

You have a funded wallet and a job to do.

Wuzzy is a search service that will crawl pages you name, index them, and answer queries about
them. It charges per page to build an index and per query to search it. There is no account and
no API key: an unpaid request answers HTTP 402 and tells you the price, and paying it is the
whole of the authentication story.

    API      https://api.wuzzy.io
    Docs     https://docs.wuzzy.io

    WALLET_PRIVATE_KEY   ~/.secrets/wuzzy-agent-evm-key

**This is real money on Base mainnet.** What you spend is gone and nothing is reimbursed. The
wallet holds USDC, which is what payments are made in; you do not need ETH, because the payment
is a signed authorization that somebody else submits and pays the gas for.

**Budget: this whole exercise should cost well under one dollar.** If anything quotes you more
than that, stop and say so rather than paying it. That is a real instruction, not a formality:
the wallet holds far more than this task needs.

## The task

1. Build an index of **memeticblock.com**. It is a small site and it publishes a sitemap;
   working out the URL list is your job, not ours.
2. Wait for it to finish, then search it. Ask it something you did not plan for in advance, and
   something you would expect it to be bad at.
3. Satisfy yourself that a result is not invented. Every result carries a claim about when a
   page was fetched and what it contained, and attested results carry an onchain uid. Check
   those claims against Base itself rather than taking the API's word for it.

Write your own client. The docs describe the payment handshake and name a package that does it
for you. If you would rather implement it by hand, the 402 body carries everything you need.

## What to tell us afterwards

Not a report card. The useful things are:

- Where you had to guess, and where the docs did not say what you needed.
- What it actually cost, in dollars, broken down between indexing and querying.
- How long each stage took, and whether the status told you enough while you waited.
- Whether the provenance is worth paying for. A free `llms.txt` answers one-off questions for
  nothing, so what does a receipt buy you that recomputing a hash yourself does not?
- Whether you would spend your own money on this again, and on what.

If something stopped you outright, say what you tried and what the failure looked like. A
confusing error is more useful to us than a workaround you found.
