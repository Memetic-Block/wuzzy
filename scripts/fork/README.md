# Fork rehearsal

A full end-to-end run of the paid loop against a forked Base mainnet: a real 402, a real
EIP-3009 signature, a real USDC settlement and real attestations written against the schema
that is actually registered on Base. Nothing costs anything and nothing reaches mainnet.

The point is not to demonstrate that our own code works. It is to use the thing ourselves, as a
customer would: pay for an index we actually want, then rely on it. What we learn is whether it
is worth paying for, which is a different question from whether it passes its tests.

## Why a fork rather than the demo stack

`compose.demo.yml` runs [`scripts/demo/mock-facilitator.ts`](../demo/mock-facilitator.ts),
which approves everything and fabricates a transaction hash. That is enough to show the shape
of the 402 loop and useless for testing whether an outsider can actually pay: a client sending
nonsense passes it exactly as well as a correct one, so a broken integration looks like a
working one.

[`facilitator.ts`](facilitator.ts) here verifies the signature against real USDC, checks the
payer's real balance and whether the authorization has been spent, and settles by submitting
`transferWithAuthorization`. A malformed payment is refused, which is the whole reason to run
this instead of the demo.

The fork also inherits real chain state, so the attestation schema registered on Base mainnet
in block 51018240 is already there. Attestations written here are made against the real
schema, not a local invention, which is the part a rehearsal most needs to get right.

## Bring it up

Everything runs in containers, under its own compose project. Bringing it up as loose host
processes is how the corpus nearly went missing once and how a stale image once ran a worker
with no embed step in it, silently.

    # 1. The pay-to address and a funded client wallet. Prints a new wallet each
    #    run, so a rehearsal never reuses a spent authorization. Needs the chain,
    #    so bring that up first.
    podman compose -f compose.fork.yml up -d chain
    bun scripts/fork/setup.ts

    # 2. Put the printed X402_PAY_TO into the environment the API reads. This
    #    file is gitignored: it changes every run.
    #      scripts/fork/local/fork.env

    # 3. Everything else.
    podman compose -f compose.fork.yml up -d

    # Published on loopback:
    #   3002  API        8082  admin for this database
    #   4000  docs       8545  the fork's RPC
    #   5435  postgres

`SEARCH_MODE=lexical` so the rehearsal needs no embedding provider for *retrieval*. The worker
still embeds what it crawls, because retrieval reads chunks and nothing writes them otherwise,
so the stub stands in for a real provider. Ranking quality is not what is under test here; the
payment and the provenance are.

Three things about the compose file are load-bearing, and each is a mistake already made:

- **`name: wuzzy-fork`.** Compose derives the project from the directory, so without it this
  file's `postgres` and `compose.demo.yml`'s are the same container. Bringing this up remounts
  `wuzzy-postgres-1` onto another volume, and a corpus that took hours to crawl appears to
  vanish while its data sits untouched on a volume nothing is mounting.
- **`build:`, never a bare `image:`.** A pinned tag runs whatever was last built. A worker
  running an image from before the embed step existed does not fail: it crawls, reports
  success, writes no chunks, and the index is silently unsearchable.
- **The chain has a healthcheck and everything that dials it waits for that.** Forking pulls
  state from upstream before anvil answers, which is long enough that a dependent started at
  the same time exits on connection refused.

## The docs the client is told to read

[BRIEFING.md](BRIEFING.md) points the client at `http://localhost:4000`, served by the `docs`
service from the sibling `wuzzy-docs` checkout. Build it there first, because the service
mounts the built output:

    (cd ../wuzzy-docs && bun run build)

It has to be the build, not `rspress dev`: dev mode renders on the client, so an agent fetching
a page over HTTP gets an empty shell and concludes there is no documentation. Point the service
somewhere else with `WUZZY_DOCS_DIR`.

## Rehearsing the live facilitator

The dry run uses `facilitator.ts` here, which settles against the fork. The live run uses
Coinbase's, which settles Base mainnet and needs credentials. Before recording, check the live
one works, because a bad key and an unsupported chain look identical from the client side:

    X402_CDP_API_KEY_ID=... X402_CDP_API_KEY_SECRET=... bun run check:facilitator

`facilitator.ts` refuses to serve a non-local chain with anvil's published test account, so it
cannot be pointed at mainnet by accident. It detects the node rather than the chain id: a fork
of Base reports 8453 as well, and that is the one place the test account is correct.

## Attest, so results carry real receipts

Run it inside the API container, which already has the database and the chain:

    podman compose -f compose.fork.yml exec \
      -e ATTESTER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
      api bun apps/backend/src/cli/wuzzy.ts attest --limit=100

That key is anvil's first account: public, well known, and funded only on a fork. A partial
run is deliberate. Leaving most of the corpus unattested is closer to production than
attesting all of it, and it means a client sees both `attested` and `not yet attested` and has
to handle the difference.

For the demo video specifically, follow [RECORDING.md](RECORDING.md): it has the shot list
and measured timings for each step.

## Handing it over

Give them [BRIEFING.md](BRIEFING.md) and the wallet from step 3. Nothing else: no repository,
no schema UID, no explanation of the payment scheme. Someone who already knows how it works
cannot tell us whether it explains itself.

Resist the urge to help while it is running. An answer given over their shoulder is an answer
the docs did not have to contain, and the gap closes without anyone writing it down.

## What a fork cannot tell you

- **The explorer links are wrong.** Results link attestations to `base.easscan.org` and
  settlements to `basescan.org`, and neither knows about fork-only transactions. On a fork,
  verify against the RPC instead:

      cast call 0x4200000000000000000000000000000000000021 \
        "getAttestation(bytes32)((bytes32,bytes32,uint64,uint64,uint64,bytes32,address,address,bool,bytes))" \
        <uid> --rpc-url http://localhost:8545

- **Fork RPC is slow.** State is fetched from upstream on first touch, so the first attest
  batch takes far longer than the same work on mainnet. It is a caching artifact, not a
  performance signal, and it is not worth optimising against.

- **Gas is not a cost signal either.** Priced from forked state, not from the live fee market.
  Use SCHEMA.md for real numbers.
