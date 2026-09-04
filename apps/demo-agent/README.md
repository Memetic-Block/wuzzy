# Wuzzy demo agent

A paying client for Wuzzy, in about a hundred lines. This is the whole integration: a
wallet, a fetch wrapper, and a POST. There is no account to create, no API key to request,
and no signup. If your agent holds funds, it can use the index.

## Quickstart

```sh
bun install

# Try it against an endpoint running in dev mode. No wallet needed.
bun run demo search "how do I deploy a contract to Base" --endpoint=http://localhost:3000/search

# Against the metered endpoint, you need a wallet with a little USDC on Base.
bun run demo wallet
# fund the printed address, then:
bun run demo search "how do I deploy a contract to Base"
```

## What happens

1. The client POSTs to `/search` with no payment.
2. The endpoint answers **402** with x402 payment requirements: price, asset, and the
   address to pay.
3. `x402-fetch` signs a payment authorization with your wallet and retries.
4. The endpoint verifies with the facilitator, runs the query, settles, and returns results
   with an `X-PAYMENT-RESPONSE` header.

Each result carries a provenance block, so you can check what you bought rather than trust
it:

```
1. Deploy a smart contract
   https://docs.base.org/deploy
   score 0.9134
   Deploying a contract to Base requires a funded wallet and a configured RPC endpoint.
   provenance  wuzzy/crawl v1  fetched 2026-02-01T00:00:00.000Z
   contentHash b3f1...  (sha256 of the canonical markdown)
   attestation https://base.easscan.org/attestation/view/0xe3...

settled onchain: https://basescan.org/tx/0xd4...
```

The `contentHash` is reproducible: fetch the same URL, run it through the published
canonicalization procedure in [VERIFY.md](../../VERIFY.md), and you get the same hash the
attestation commits to. Nothing asks you to trust the index.

## Wallet handling

`bun run demo wallet` generates a fresh key and writes it to
`~/.config/wuzzy/demo-wallet.json` with mode 0600. That path is deliberately **outside the
repository**, so a funded key cannot end up in a commit. Set `WUZZY_WALLET_FILE` to move it,
or `DEMO_PRIVATE_KEY` to supply one directly.

Fund it with pocket change. The client refuses to pay more than 0.10 USDC for a single
query regardless of what the endpoint asks for, and you can lower that.

## Options

| Flag | Default |
| ---- | ------- |
| `--endpoint=<url>` | `https://wuzzy.io/search`, or `WUZZY_ENDPOINT` |
| `--network=<base\|base-sepolia>` | `base` |
| `--top=<n>` | 5 |

## Why it lives here

It is a bun workspace in the Wuzzy monorepo for now, and depends on nothing in
`apps/backend`. Splitting it into its own public repository is a `git subtree split` when
that becomes useful.
