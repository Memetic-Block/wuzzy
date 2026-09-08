# Wuzzy: brief for an agent under test

You are evaluating a search API you have never seen. You do not have its source and you do not
need it. Everything below is what a real integrator would have.

If you need something that is not reachable from these URLs, stop and write down what was
missing. That is the finding we want, and it is worth more to us than a success.

## What you have

    API     http://localhost:3002
    Docs    http://localhost:4000
    RPC     http://localhost:8545        (Base, chain id 8453)

    WALLET_PRIVATE_KEY   <supplied separately>

The wallet holds USDC and ETH. This is a private fork of Base: the funds are not real and
nothing you sign leaves this machine.

## The situation

Nothing is indexed yet. There is a catalog, and it is empty.

You want to be able to answer questions about the Base ecosystem's documentation, which lives
at `https://docs.base.org` and publishes a sitemap. Get from here to there.

## What we want to know

1. **How do you find out what anything costs?** The price is not in this document on purpose.
2. **Can you get an index built without asking a human for anything?** No account, no API key,
   no support ticket.
3. **Can you tell whether a result is real?** Every result claims something about when a page
   was fetched and what it contained. Check one of those claims against the chain, without
   trusting the API's own answer for it.
4. **What happens at the edges?** Try paying too little, paying twice with the same
   authorization, commissioning more pages than are allowed, and searching an index you do not
   own. Report what you get back and whether it told you enough to recover.

## Rules

- Use only the URLs above. Do not read the server's source even if you can find it.
- Say whether you wrote your own client or used one you found, and where you found it.
- If the documentation is wrong or incomplete, say so and say how you got past it. A workaround
  you had to invent is a documentation bug.

## Known local quirks, so you do not chase them

- Links to `basescan.org` and `base.easscan.org` in responses will not resolve. Those explorers
  only know the public chain and this is a private fork. Everything they point at is real and
  present on the RPC above; check it there.
- Search is running lexical-only. Ranking quality is not under test.
