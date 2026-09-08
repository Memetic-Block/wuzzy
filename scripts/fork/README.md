# Fork rehearsal

A full end-to-end run of the paid loop against a forked Base mainnet: a real 402, a real
EIP-3009 signature, a real USDC settlement and real attestations written against the schema
that is actually registered on Base. Nothing costs anything and nothing reaches mainnet.

The point is not to demonstrate that our own code works. It is to hand the running system to
someone who has never seen it and find out whether they can pay us and check what they bought.

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

Five processes. Each one prints what it bound to; none of them daemonise.

    # 1. The chain. Anything after block 51018240 has the schema.
    anvil --fork-url https://mainnet.base.org

    # 2. A database of its own. NOT the demo database: attestations written
    #    here have UIDs that exist only on the fork, and writing them into the
    #    demo corpus would leave it claiming onchain proof that nothing can
    #    resolve.
    #
    #    Empty, for the commissioning demo, where the whole point is that
    #    nothing is indexed yet:
    podman exec wuzzy-postgres-1 psql -U app -d postgres \
      -c "DROP DATABASE IF EXISTS wuzzy_demo;" -c "CREATE DATABASE wuzzy_demo OWNER app;"
    (cd apps/backend && POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5433 \
      POSTGRES_DB=wuzzy_demo POSTGRES_USER=app POSTGRES_PASSWORD=app bun run migration:run)

    #    Or a copy of the demo corpus, to rehearse search against real volume:
    podman exec wuzzy-postgres-1 sh -c 'pg_dump -U app -d app | psql -q -U app -d wuzzy_fork'

    # 3. Fund a fresh client and print what it needs. Prints a new wallet each
    #    run, so a rehearsal never reuses a spent authorization.
    bun scripts/fork/setup.ts

    # 4. The facilitator.
    bun scripts/fork/facilitator.ts

    # 5. The API, with the values step 3 printed.
    POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5433 POSTGRES_DB=wuzzy_demo \
    POSTGRES_USER=app POSTGRES_PASSWORD=app \
    PORT=3002 SEARCH_MODE=lexical \
    X402_ENABLED=true X402_NETWORK=base X402_PRICE='$0.01' \
    X402_PAY_TO=<from step 3> X402_FACILITATOR_URL=http://127.0.0.1:39601 \
    EAS_CHAIN=base BASE_RPC_URL=http://127.0.0.1:8545 \
    bun apps/backend/src/main.ts

`SEARCH_MODE=lexical` so the rehearsal needs no embedding provider. Retrieval quality is not
what is under test here; the payment and the provenance are.

## Rehearsing the live facilitator

The dry run uses `facilitator.ts` here, which settles against the fork. The live run uses
Coinbase's, which settles Base mainnet and needs credentials. Before recording, check the live
one works, because a bad key and an unsupported chain look identical from the client side:

    X402_CDP_API_KEY_ID=... X402_CDP_API_KEY_SECRET=... bun run check:facilitator

`facilitator.ts` refuses to serve a non-local chain with anvil's published test account, so it
cannot be pointed at mainnet by accident. It detects the node rather than the chain id: a fork
of Base reports 8453 as well, and that is the one place the test account is correct.

## Attest, so results carry real receipts

    POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5433 POSTGRES_DB=wuzzy_demo \
    POSTGRES_USER=app POSTGRES_PASSWORD=app \
    EAS_CHAIN=base BASE_RPC_URL=http://127.0.0.1:8545 \
    EAS_SCHEMA_UID=0x15616641fbb8e7ee6a63f4904a622a154972e47453062c845845e1f2387f9f1a \
    ATTESTER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
    bun apps/backend/src/cli/wuzzy.ts attest --limit=100

That key is anvil's first account: public, well known, and funded only on a fork. A partial
run is deliberate. Leaving most of the corpus unattested is closer to production than
attesting all of it, and it means a client sees both `attested` and `not yet attested` and has
to handle the difference.

For the demo video specifically, follow [RECORDING.md](RECORDING.md): it has the shot list
and measured timings for each step.

## Handing it to a client

Give them [BRIEFING.md](BRIEFING.md) and the wallet from step 3. Nothing else: no repository,
no schema UID, no explanation of the payment scheme. If they need something that is not
reachable from those two URLs, that is the finding.

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
