# Wuzzy: brief for an agent that wants a corpus searchable

You need to answer questions about the Base ecosystem's documentation, accurately, with
sources you can point at. You do not have that today.

Wuzzy is a service that will crawl pages you name, index them, and answer queries about them.
It charges per page to build an index and per query to search it, and it pays out to a wallet
rather than an account, so there is nothing to sign up for. You have a funded wallet. Go and
get yourself a good Base docs index, then use it.

## What you have

    API     http://localhost:3002
    Docs    http://localhost:4000
    RPC     http://localhost:8545        (Base, chain id 8453)

    WALLET_PRIVATE_KEY   <supplied separately>

This runs against a private fork of Base. The funds are real USDC and ETH as far as every
signature and balance check is concerned, but they exist only on this machine, and nothing you
sign leaves it. Spend as though it counted: the point is to find out what this costs and
whether it is worth it.

## What you are trying to end up with

Something you would actually use. Concretely:

- The Base ecosystem's docs indexed well enough that a question you did not plan for gets a
  useful answer. `https://docs.base.org` publishes a sitemap and is the obvious starting
  point. Whether that one site is enough to call the job done is your call, not ours.
- A clear idea of what it cost you to build, and what each query costs.
- Confidence that an answer is not invented. Every result carries a claim about when a page
  was fetched and what it contained. Satisfy yourself that those claims hold, using the RPC
  above rather than the API's own word for it. You are about to rely on this thing.

How you get there is up to you. Nothing here is a test with a right answer.

## How to work

You have exactly what a customer would have: two URLs and a wallet. Use the docs. If you write
your own client, say so; if you find one, say where.

Tell us afterwards what it was like to use, in whatever detail you think is warranted. Not a
report card: the things worth hearing are where you had to guess, where the docs did not say
what you needed, where a price or a limit surprised you, and whether you would spend your own
money on it again. If something stopped you outright, say what you tried.

## Local quirks, so you do not chase them

- Links to `basescan.org` and `base.easscan.org` in responses will not resolve. Those explorers
  only know the public chain, and this is a private fork. What they point at is real and
  present on the RPC above, so check it there.
- Search is running lexical-only, so ranking is keyword-driven rather than semantic. Judge the
  index on coverage rather than on how clever the ordering is.
- Results may say a page is not yet attested onchain. That is a real state of the product, not
  a fault: attesting is a separate step that costs gas, and it runs behind indexing.
