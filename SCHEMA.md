# The Wuzzy attestation schema

What a Wuzzy attestation looks like onchain, and how to read one without trusting us or
running our code.

This is the companion to [VERIFY.md](VERIFY.md). That document specifies how the hashes are
computed; this one specifies the record those hashes are written into.

> **Status: experimental.** The schema pairs with the protocol identifier
> `wuzzy/crawl-experimental`, which says outright that no permanence promise has been made
> yet. Both may change. The suffix disappearing is the announcement that they have frozen.
> See "Changing the schema" at the end.

## The schema

Attestations are written with the [Ethereum Attestation Service](https://attest.org) on Base.

```
string url,uint8 protocolVersion,bytes32 contentHash,bytes32 rawHash,uint64 fetchedAt
```

| | |
| --- | --- |
| **Schema UID** | `0x15616641fbb8e7ee6a63f4904a622a154972e47453062c845845e1f2387f9f1a` |
| **Resolver** | `0x0000000000000000000000000000000000000000` (none) |
| **Revocable** | `true` |
| **EAS** | `0x4200000000000000000000000000000000000021` |
| **SchemaRegistry** | `0x4200000000000000000000000000000000000020` |

EAS and the registry are OP Stack predeploys, so those addresses are identical on Base mainnet
and Base Sepolia. The schema UID is identical on both too, for the reason in "Registering"
below.

## Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `url` | `string` | The absolute URL fetched, after redirects. The URL is part of the canonicalization input, so it belongs in the record. |
| `protocolVersion` | `uint8` | Which procedure produced the hashes, currently `1`. Together with the schema UID this identifies the procedure; see "Identifying a procedure". |
| `contentHash` | `bytes32` | sha256 over the canonical markdown. Commits to the readable content. |
| `rawHash` | `bytes32` | sha256 over the exact bytes the origin served, with no normalization. Commits to the transfer. |
| `fetchedAt` | `uint64` | Unix seconds when the fetch happened. Distinct from the EAS `time` field, which is when the attestation was written. |

Two hashes rather than one because they answer different questions. `rawHash` proves what came
over the wire and changes if a single byte does. `contentHash` proves what the page *said* and
survives changes that do not alter the content, such as line endings or trailing whitespace.
A page whose `rawHash` moved but whose `contentHash` did not was re-served, not rewritten.

## What the schema deliberately omits

Two absences are load-bearing, and each is guarded by a function in
[apps/backend/src/attest/schema.ts](apps/backend/src/attest/schema.ts) so that adding the
field fails the build rather than reaching a chain.

**No content.** Only hashes and metadata go onchain, never the page. The index is public, the
corpus is other people's writing, and an attestation is a commitment to what was fetched
rather than a copy of it. `schemaCarriesNoContent` rejects a definition naming `content`,
`markdown`, `body`, `text`, `html`, `snippet` or `title`.

**No index, owner or payer.** Provenance is a property of the fetch, not of who commissioned
it. A URL that several indexes want is crawled, canonicalized and attested exactly once, and a
private index's membership must not be readable off Base by anyone watching the attester.
`schemaCarriesNoIndex` rejects a definition naming `index`, `indexId`, `index_id`, `owner`,
`wallet` or `payer`.

## The envelope

Beyond the schema payload, EAS carries its own fields. Wuzzy sets them as follows.

| EAS field | Value | Why |
| --- | --- | --- |
| `recipient` | zero address | An attestation is a statement about a URL, not about a person. There is no subject to name. |
| `expirationTime` | `0` (never) | A statement about a past fetch does not stop being true. |
| `revocable` | `true` | Retained so a mistaken attestation can be withdrawn rather than only contradicted. |
| `refUID` | zero | Attestations are independent; there is no chain of revisions. |
| `attester` | the operator wallet | Who is making the claim. This is the only identity in the record. |

## Reading an attestation

The payload is **plain ABI encoding of the field types**, so no EAS SDK is required. Any
library that can ABI-decode will do.

```ts
import { ethers } from 'ethers';

const TYPES = ['string', 'uint8', 'bytes32', 'bytes32', 'uint64'];

const eas = new ethers.Contract(
  '0x4200000000000000000000000000000000000021',
  ['function getAttestation(bytes32) view returns (tuple(bytes32 uid,bytes32 schema,uint64 time,uint64 expirationTime,uint64 revocationTime,bytes32 refUID,address recipient,address attester,bool revocable,bytes data))'],
  new ethers.JsonRpcProvider('https://mainnet.base.org'),
);

const attestation = await eas.getAttestation(uid);
const [url, protocolVersion, contentHash, rawHash, fetchedAt] =
  ethers.AbiCoder.defaultAbiCoder().decode(TYPES, attestation.data);
```

A real decode, from the rehearsal run:

```
schema           0x15616641fbb8e7ee6a63f4904a622a154972e47453062c845845e1f2387f9f1a
attester         0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
recipient        0x0000000000000000000000000000000000000000
revocable        true
expirationTime   0
revocationTime   0

url              https://docs.base.org/agents/guides/batch-calls
protocolVersion  1
contentHash      0x2a9688cd036df3bb183663a67820407476f8ddd54dd3ca6e6b5c1746b5248354
rawHash          0x3529ef8770591c740fc3e23bd21932a049b51746f2c9556d5c60eb67a9115ae2
fetchedAt        1788645452
```

**Check `revocationTime` before trusting an attestation.** A non-zero value means it was
withdrawn. `getAttestation` returns revoked attestations rather than erroring.

## Verifying one end to end

1. Read the attestation and decode it as above.
2. Fetch `url` yourself.
3. Run the procedure in [VERIFY.md](VERIFY.md) over the bytes you received.
4. Compare your sha256 against `contentHash`.

A mismatch means one of three things, and they are worth separating: the page changed since
`fetchedAt`, you ran a different procedure than the `(protocol, protocolVersion)` pair names,
or the attestation is wrong. The first is expected on a live web and is why `fetchedAt` is in
the record.

`bun run wuzzy verify <url>` does this against our own copy and exits 0 on a match, 1 on a
mismatch, 2 when the URL is not indexed.

## Identifying a procedure

A procedure is identified by the pair **(schema UID, `protocolVersion`)**.

The protocol name is deliberately not a field. It is a constant, and carrying it cost 17% of
every attestation's gas to repeat the same string forever: 394,982 gas with it, 327,329
without, measured against real EAS bytecode. The schema UID in the attestation envelope
already says which schema, and this document says which procedure that schema belongs to.

**One rule follows, and it is load-bearing.** A schema's UID derives from its field *names*,
so renaming the procedure cannot change it: the string `wuzzy/crawl-experimental` appears
nowhere in the schema definition. `protocolVersion` is therefore the only thing distinguishing
two procedures written against this schema.

So **dropping `-experimental` must bump `protocolVersion` to 2.** Leaving it at 1 would make
frozen attestations byte-identical to experimental ones and the freeze invisible onchain.
That is enforced by a test rather than left to memory: if `PROTOCOL` stops ending in
`-experimental` while `PROTOCOL_VERSION` is still 1, the build fails.

A verifier should read the pair, never the version alone.

## Registering

The registry derives a schema's UID as:

```
keccak256(abi.encodePacked(schema, resolver, revocable))
```

There is no registrant, no nonce and no chain id in that preimage. Three consequences follow,
and all three were confirmed against a forked Base mainnet:

- **The UID is knowable before registration.** Computing it locally reproduces
  `0x15616641...` exactly, so registration cannot yield a surprising value.
- **It is the same on every chain.** Base and Base Sepolia share the UID.
- **Registration is idempotent and unowned.** A second registration reverts `AlreadyExists`,
  including from a different account, so nobody can register "our" schema to a different
  definition, and anyone may register this one.

```sh
cast send 0x4200000000000000000000000000000000000020 \
  "register(string,address,bool)" \
  "string url,uint8 protocolVersion,bytes32 contentHash,bytes32 rawHash,uint64 fetchedAt" \
  0x0000000000000000000000000000000000000000 true \
  --private-key "$ATTESTER_PRIVATE_KEY" --rpc-url https://mainnet.base.org
```

Registration costs 187,121 gas, well under a cent on Base.

> As of 2026-09-07 this schema is **not yet registered** on Base mainnet or Base Sepolia. The
> UID above is unclaimed and is what registration will produce.

## Cost

Measured against forked Base mainnet, 200 attestations across 4 `multiAttest` batches of 50:

| | |
| --- | --- |
| Gas per attestation | **327,329** |
| Stored payload | 288 bytes |
| Gas per batch of 50 | 16.4M, about 4.1% of a 400M block |
| L1 data fee share | 0.02% of total |

Cost is dominated by storing the payload: a cold `SSTORE` is 22,100 gas per word, and 352
bytes is 9 words. **It scales with what the schema stores**, which is now almost entirely the
`url` string; dropping the constant `protocol` string saved 67,653 gas per attestation.
That accounts for the figure almost exactly: 11 words of payload on top of the 146,331 gas EAS
charges for an attestation regardless of contents (measured under "Roadmap" below).
Because the L1 data fee is negligible on Base, calldata batching tweaks do not move the total;
batching only reduces the number of transactions.

Attestations are written in batches via `multiAttest`. The practical ceiling per transaction
is around 150, set by the 128KB transaction size limit rather than by gas.

## Roadmap

The shape above is a deliberate choice, not the only one available. These alternatives were
measured against real EAS bytecode on a forked Base mainnet, 50 attestations per variant, so
the numbers are observed rather than estimated. USD figures use the whole 4555-document corpus
at 0.006 gwei and $2505/ETH.

| schema | payload | gas each | cost for 4555 | saving |
| --- | --- | --- | --- | --- |
| current, after dropping `protocol` | 288 B | 327,329 | $22.41 | - |
| `bytes32 urlHash` plus the rest | 160 B | 236,972 | $16.22 | 40% |
| `bytes32 attestationHash`, everything combined | 32 B | 146,331 | $10.02 | 63% |

The current row reads slightly higher here than the 388,188 in "Cost" above because this
comparison used synthetic URLs a little longer than the corpus average. The variants are
measured against each other under identical inputs, so the ratios are the point.

### Why the fields are not collapsed into one hash

**146,331 gas is a floor.** That is what EAS costs to record an attestation carrying a
32-byte payload: the attestation struct, the UID mapping, and the event. Sixty-three percent
of the current cost is that floor, so collapsing every field into a single commitment saves
at most 2.7x and cannot do better.

What it would cost is the record's ability to speak for itself. Today an attestation is
**published**: a reader follows the UID and sees the URL, the protocol and version, both
hashes, and the fetch time. Collapsed to one hash it becomes **commit-and-reveal**: still
binding, since the preimage cannot be changed afterwards, but a reader can only check it if we
hand them the preimage first.

Three properties go with that, and they are the ones the product is selling:

- What was crawled is no longer readable from the chain alone; an observer can count
  attestations but not read them.
- The index can no longer be audited independently of us.
- The receipt stops being human-readable, so "check it yourself" becomes "recompute a hash
  using our data".

Saving $17 once, on a corpus that already exists, is not worth that. The trade would look
different at a hundred times the scale, which is what the next section is for.

### The lever that actually scales

Collapsing fields is the wrong optimization to reach for if cost becomes a real constraint,
because it is bounded at 2.7x. Batching is not.

A single attestation carrying a **Merkle root over all 4555 documents** costs 394,982 gas in
total rather than per document: about **$0.006 for the whole corpus, a 4555x reduction**.

Per-document verifiability survives it. Each result's provenance block would carry the root's
UID plus a Merkle proof of roughly 13 hashes, and a verifier fetches the page, computes
`contentHash` by the procedure in [VERIFY.md](VERIFY.md), builds the leaf, and checks the
proof against the onchain root.

What it would give up:

- **Per-document revocation.** Revoking means publishing a new root, not withdrawing one
  attestation.
- **A per-document easscan page.** The chain holds one root, so the human-readable receipt
  has to be rendered by a verifier rather than looked up.
- **Simplicity.** Proofs have to be stored, served, and kept consistent with re-crawls, which
  change a document's hash and therefore its leaf.

This is a larger change than a schema edit, and it is the direction to take if the corpus
grows by orders of magnitude. It is recorded here so the reasoning is not rediscovered later.

## Changing the schema

While the identifier carries `-experimental`, nothing here is frozen: it is a demo-stage
artifact and no promise has been made to anyone building against it.

Dropping the suffix is the freeze. After that, the schema string is immutable, because its UID
is derived from it and every existing attestation references that UID. A changed field list is
a **new schema with a new UID**, registered alongside the old one, and old attestations stay
readable against the old UID indefinitely.

That is a separate decision from the canonicalization procedure's version. The schema says
what a record contains; `protocolVersion` says how the hashes inside it were computed. Either
can change without the other, which is why both identifiers are in the record.
