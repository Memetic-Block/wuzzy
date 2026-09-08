/**
 * An x402 facilitator that really settles, against a forked Base mainnet.
 *
 * scripts/demo/mock-facilitator.ts approves everything and fabricates a
 * transaction hash. That is fine for demonstrating the HTTP shape of the 402
 * loop, and useless for testing whether an outsider can actually pay us: a
 * client sending nonsense passes it just as well as a correct one.
 *
 * This one verifies the EIP-3009 signature against real USDC, checks the
 * payer's real balance and whether the authorization has already been used,
 * and settles by submitting `transferWithAuthorization` to the fork. The money
 * is not real. Everything else about the exchange is.
 *
 *   anvil --fork-url https://mainnet.base.org
 *   bun scripts/fork/facilitator.ts
 *
 * The same process settles on real Base if pointed there, which is the point:
 * a dry run should differ from the live run in the endpoint and the key, and
 * nowhere else. The public facilitator at x402.org is testnet-only, so a
 * mainnet deployment either uses an authenticated third party or runs this.
 *
 *   FORK_RPC_URL=https://mainnet.base.org \
 *   FACILITATOR_RELAYER_KEY=0x... bun scripts/fork/facilitator.ts
 *
 * Self-facilitating is legitimate under x402: the payer's signature is what
 * proves the payment, and anyone can check it. What this process does NOT do
 * is authenticate or rate-limit its callers, so it belongs beside the resource
 * server it settles for and must not be exposed as a public service.
 */
import { ethers } from 'ethers';

const PORT = Number(process.env.FORK_FACILITATOR_PORT ?? 39601);
const RPC = process.env.FORK_RPC_URL ?? 'http://127.0.0.1:8545';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/**
 * The account that submits `transferWithAuthorization` and pays its gas. It
 * never holds the payment: USDC moves from payer to payee inside that call.
 *
 * Defaults to anvil's first account, which is public, well known and funded
 * only on a fork. A real network needs a real one, and the process says which
 * it is using at startup so a mainnet run cannot quietly use the test key.
 */
const ANVIL_ACCOUNT_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const RELAYER_KEY = process.env.FACILITATOR_RELAYER_KEY ?? ANVIL_ACCOUNT_0;

const ABI = [
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function name() view returns (string)',
  'function version() view returns (string)',
];

/** ethers types contract calls dynamically; this is the surface we use. */
interface Usdc {
  transferWithAuthorization(
    from: string, to: string, value: bigint, validAfter: bigint, validBefore: bigint,
    nonce: string, v: number, r: string, s: string,
  ): Promise<ethers.ContractTransactionResponse>;
  authorizationState(authorizer: string, nonce: string): Promise<boolean>;
  balanceOf(account: string): Promise<bigint>;
  name(): Promise<string>;
  version(): Promise<string>;
}

const provider = new ethers.JsonRpcProvider(RPC);
const relayer = new ethers.Wallet(RELAYER_KEY, provider);
const usdc = new ethers.Contract(USDC, ABI, relayer) as unknown as Usdc;

const chainId = Number((await provider.getNetwork()).chainId);
const domain = {
  name: await usdc.name(),
  version: await usdc.version(),
  chainId,
  verifyingContract: USDC,
};
const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

interface Authorization {
  readonly from: string;
  readonly to: string;
  readonly value: string;
  readonly validAfter: string;
  readonly validBefore: string;
  readonly nonce: string;
}

interface Body {
  paymentPayload?: {
    scheme?: string;
    network?: string;
    payload?: {
      signature?: string;
      authorization?: Authorization;
    };
  };
  paymentRequirements?: { maxAmountRequired?: string; payTo?: string; asset?: string };
}

/** Everything that must hold before a cent moves, in the order it can be checked. */
async function check(body: Body): Promise<{ payer: string } | { reason: string; payer: string }> {
  const payment = body.paymentPayload;
  const need = body.paymentRequirements ?? {};
  const auth = payment?.payload?.authorization;
  const signature = payment?.payload?.signature;
  const payer = auth?.from ?? '';

  if (payment?.scheme !== 'exact') return { reason: 'unsupported_scheme', payer };
  if (!auth || !signature) return { reason: 'invalid_exact_evm_payload_authorization', payer };

  const value = {
    from: auth.from,
    to: auth.to,
    value: BigInt(auth.value),
    validAfter: BigInt(auth.validAfter),
    validBefore: BigInt(auth.validBefore),
    nonce: auth.nonce,
  };

  let recovered: string;
  try {
    recovered = ethers.verifyTypedData(domain, TYPES, value, signature);
  } catch {
    return { reason: 'invalid_exact_evm_payload_signature', payer };
  }
  if (recovered.toLowerCase() !== auth.from.toLowerCase()) {
    return { reason: 'invalid_exact_evm_payload_signature', payer };
  }

  if (need.asset && need.asset.toLowerCase() !== USDC.toLowerCase()) {
    return { reason: 'invalid_exact_evm_payload_asset', payer };
  }
  if (need.payTo && String(auth.to).toLowerCase() !== need.payTo.toLowerCase()) {
    return { reason: 'invalid_exact_evm_payload_recipient_mismatch', payer };
  }
  if (need.maxAmountRequired && value.value < BigInt(need.maxAmountRequired)) {
    return { reason: 'insufficient_funds', payer };
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < value.validAfter || now > value.validBefore) {
    return { reason: 'invalid_exact_evm_payload_authorization_valid_before', payer };
  }

  if (await usdc.authorizationState(auth.from, auth.nonce)) {
    return { reason: 'invalid_exact_evm_payload_authorization_used', payer };
  }
  if ((await usdc.balanceOf(auth.from)) < value.value) {
    return { reason: 'insufficient_funds', payer };
  }

  return { payer };
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = (await request.json().catch(() => ({}))) as Body;
    const network = body.paymentPayload?.network ?? 'base';

    if (path === '/supported') {
      return Response.json({ kinds: [{ scheme: 'exact', network: 'base' }] });
    }

    if (path === '/verify') {
      const outcome = await check(body);
      return 'reason' in outcome
        ? Response.json({ isValid: false, invalidReason: outcome.reason, payer: outcome.payer })
        : Response.json({ isValid: true, payer: outcome.payer });
    }

    if (path === '/settle') {
      const outcome = await check(body);
      if ('reason' in outcome) {
        return Response.json({
          success: false,
          errorReason: outcome.reason,
          transaction: '',
          network,
          payer: outcome.payer,
        });
      }

      const auth = body.paymentPayload!.payload!.authorization!;
      const sig = ethers.Signature.from(body.paymentPayload!.payload!.signature!);
      try {
        const tx = await usdc.transferWithAuthorization(
          auth.from, auth.to, BigInt(auth.value),
          BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce,
          sig.v, sig.r, sig.s,
        );
        const receipt = await tx.wait();
        // `wait` resolves null if the transaction was replaced. On a fork that
        // should not happen, and reporting success without a hash would be a
        // settlement nobody can look up.
        if (!receipt) throw new Error('transaction was replaced before it was mined');
        console.log(`settled ${auth.value} to ${auth.to} in ${receipt.hash}`);
        return Response.json({
          success: true,
          transaction: receipt.hash,
          network,
          payer: outcome.payer,
        });
      } catch (error) {
        return Response.json({
          success: false,
          errorReason: (error as Error).message.slice(0, 120),
          transaction: '',
          network,
          payer: outcome.payer,
        });
      }
    }

    return new Response('{}', { status: 404 });
  },
});

const usingTestKey = RELAYER_KEY === ANVIL_ACCOUNT_0;
const balance = await provider.getBalance(relayer.address);

console.log(`x402 facilitator on :${PORT}`);
console.log(`  chain    ${chainId} via ${RPC}`);
console.log(`  USDC     ${domain.name} v${domain.version}`);
console.log(`  relayer  ${relayer.address}${usingTestKey ? '  (anvil test account)' : ''}`);
console.log(`  gas      ${ethers.formatEther(balance)} ETH`);

// A live chain and the published test key is a run that will fail on its first
// settlement, after the client has already signed. Say so at startup instead.
//
// The chain id cannot answer this on its own: a fork of Base mainnet reports
// 8453 too, and that is the one place the test account is the right key. Ask
// the node what it is instead. `anvil_nodeInfo` exists on anvil and on nothing
// that settles real money.
const isLocalNode = await provider
  .send('anvil_nodeInfo', [])
  .then(() => true)
  .catch(() => false);

if (!isLocalNode && usingTestKey) {
  console.error(`\nRefusing to serve chain ${chainId} with anvil's public test account.`);
  console.error('Set FACILITATOR_RELAYER_KEY to a funded key.');
  process.exit(1);
}
if (balance === 0n) {
  console.warn('\nThe relayer holds no ETH, so every settlement will fail.');
}
