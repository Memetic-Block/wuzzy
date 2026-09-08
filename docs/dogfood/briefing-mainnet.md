# Wuzzy: brief for an agent buying a corpus with real money

You need to answer questions about a body of documentation, accurately, with sources you can
point at. You do not have that today.

Wuzzy is a service that will crawl pages you name, index them, and answer queries about them.
It charges per page to build an index and per query to search it, and it pays out to a wallet
rather than an account, so there is nothing to sign up for. You have a funded wallet. Go and
get yourself an index you would actually rely on, then rely on it.

## This is real money on Base mainnet

Everything you sign settles on public Base. The wallet holds real USDC and what you spend is
gone. Nothing here is reimbursed and nothing is a sandbox.

That is the point. We want to know what this costs a real buyer and whether it was worth it,
and neither question survives being asked in a testnet. Spend deliberately, quote before you
commit, and stop when you have what you need.

You do not need ETH. Payment is an EIP-3009 authorization over USDC, which the facilitator
submits and pays the gas for, so your balance moves in USDC only.

## What you have

    API      https://api.wuzzy.io
    Docs     https://docs.wuzzy.io
    Site     https://wuzzy.io

    WALLET_PRIVATE_KEY   <supplied separately>

There is no key, no account and no header to configure. An unpaid request answers HTTP 402 and
tells you the price; paying it is the whole of the authentication story.

## Writing a client

We do not ship a client that takes a private key as input, so write one. The shortest path is
[`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch), which wraps `fetch` so a 402 is
paid and retried for you. Use the current major version rather than the older `x402-fetch`
package.

If you would rather implement the handshake yourself, the 402 body carries everything you need
and the docs describe it. Say which route you took.

## What you are trying to end up with

Something you would actually use. Concretely:

- A corpus indexed well enough that a question you did not plan for gets a useful answer. You
  choose the site and you supply the URL list; most documentation sites publish a sitemap.
  Whether one site is enough to call the job done is your call, not ours.
- A clear idea of what it cost to build and what each query costs, in dollars you actually
  spent.
- Confidence that an answer is not invented. Every result carries a claim about when a page was
  fetched and what it contained, and an attested result carries an onchain uid. Satisfy
  yourself that those claims hold, using Base directly rather than our word for it. You are
  about to rely on this thing.

How you get there is up to you. Nothing here is a test with a right answer.

## How to work

You have exactly what a customer would have: three URLs and a wallet. Use the docs. Do not read
our source, and tell us if you end up wanting to.

Tell us afterwards what it was like to use, in whatever detail you think is warranted. Not a
report card: the things worth hearing are where you had to guess, where the docs did not say
what you needed, where a price or a limit surprised you, and whether you would spend your own
money on it again. If something stopped you outright, say what you tried.

Two things we would especially like an honest answer on, because we cannot judge them from the
inside:

- **Whether the provenance is worth paying for.** A free `llms.txt` answers one-off questions
  for nothing. What does a receipt buy you that recomputing a hash yourself does not?
- **How long you waited, and whether the status told you enough while you waited.**

## What is different from a sandbox

The explorer links in our responses resolve here. A settlement hash opens on `basescan.org` and
an attestation uid opens on `base.easscan.org`, and both are the real record rather than a
local invention. Check them.
