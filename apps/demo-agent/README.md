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

Searching the global index needs no wallet against a dev-mode endpoint. Commissioning an
index always needs one, funded or not, because an index has an owner.

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

## Commissioning your own index

The global index is one index among others. You can pay per page for one of your own: a
research corpus, a private working set, your project's own docs. It is the same primitive
configured differently, and the same metered `/search` reads it.

```sh
# What the operator publishes. Free to read.
bun run demo indexes

# Pay per page for a corpus of your own. Unlisted, readable only by you and
# whichever wallets you name.
bun run demo commission --name="ERC-8004 research" --private \
  --reader=0xabc... \
  https://eips.ethereum.org/EIPS/eip-8004 \
  https://docs.attest.org/docs/welcome

# Watch it fill, then query it.
bun run demo status erc-8004-research
bun run demo search "trustless agent identity" --index=erc-8004-research

# Add to it later, at the same per-page price.
bun run demo append erc-8004-research https://eips.ethereum.org/EIPS/eip-712
```

Three things are worth knowing before you pay:

- **Pages already in the store are not re-crawled.** They join your index immediately,
  carrying the attestations they already have. Two indexes wanting the same URL is one
  fetch and one attestation, not two.
- **The price is quoted from your URL list and nothing else.** The amount in the 402 is the
  amount you sign for. A list over the page cap is refused before any payment settles.
- **Private hides your curation, not your crawling.** Every fetch is attested publicly with
  the URL in the clear, which is what makes the provenance checkable by anyone. What stays
  private is that *you* asked for it, and what else is in your index. A URL nobody else
  would ever request is still inferable from the attestation stream.

Appending and deleting are owner-only, and the check runs after your payment is verified
but before it settles, so a wallet that is turned away is not charged for finding out.

## Options

| Flag | Default |
| ---- | ------- |
| `--endpoint=<url>` | `https://wuzzy.io/search`, or `WUZZY_ENDPOINT` |
| `--network=<base\|base-sepolia>` | `base` |
| `--top=<n>` | 5 |
| `--index=<id\|slug>` | the global index |
| `--name=<text>` | `Untitled index` |
| `--private` | listed and open |
| `--reader=<0x...>` | none; repeatable, implies `--private` |

## Why it lives here

It is a bun workspace in the Wuzzy monorepo for now, and depends on nothing in
`apps/backend`. Splitting it into its own public repository is a `git subtree split` when
that becomes useful.
