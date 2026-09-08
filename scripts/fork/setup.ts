/**
 * Prepares a forked Base mainnet for an end-to-end rehearsal, and prints the
 * handful of values an outside client needs.
 *
 * The fork inherits real state, so the attestation schema registered on Base
 * mainnet is already there and attestations written here are made against the
 * real one. Nothing costs anything and nothing reaches mainnet.
 *
 *   anvil --fork-url https://mainnet.base.org
 *   bun scripts/fork/setup.ts
 *
 * Funds a fresh wallet by moving USDC off a large holder with anvil's
 * impersonation, which is why this only works against a fork.
 */
import { ethers } from 'ethers';

const RPC = process.env.FORK_RPC_URL ?? 'http://127.0.0.1:8545';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const REGISTRY = '0x4200000000000000000000000000000000000020';
const SCHEMA_UID = '0x15616641fbb8e7ee6a63f4904a622a154972e47453062c845845e1f2387f9f1a';
/** Holds nine figures of USDC on Base. Only ever impersonated, never signed for. */
const WHALE = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';

const provider = new ethers.JsonRpcProvider(RPC);

const net = await provider.getNetwork();
if (Number(net.chainId) !== 8453) {
  console.error(`Expected a Base mainnet fork (8453), got chain ${net.chainId}.`);
  console.error('Start one with: anvil --fork-url https://mainnet.base.org');
  process.exit(1);
}

// The schema has to be inherited from the fork's parent, not registered here:
// attesting against a locally-invented schema would rehearse the wrong thing.
interface SchemaRecord {
  readonly uid: string;
  readonly resolver: string;
  readonly revocable: boolean;
  readonly schema: string;
}

const registry = new ethers.Contract(
  REGISTRY,
  ['function getSchema(bytes32) view returns (tuple(bytes32 uid, address resolver, bool revocable, string schema))'],
  provider,
) as unknown as { getSchema(uid: string): Promise<SchemaRecord> };
const record = await registry.getSchema(SCHEMA_UID);
if (record.uid === ethers.ZeroHash) {
  console.error('The attestation schema is not on this fork. Fork a block after 51018240.');
  process.exit(1);
}

/** A fresh wallet each run, so a rehearsal never reuses a spent authorization. */
const agent = ethers.Wallet.createRandom();
const payTo = ethers.Wallet.createRandom();

await provider.send('anvil_setBalance', [agent.address, '0x56BC75E2D63100000']); // 100 ETH
await provider.send('anvil_setBalance', [WHALE, '0x56BC75E2D63100000']);
await provider.send('anvil_impersonateAccount', [WHALE]);

const usdc = new ethers.Contract(
  USDC,
  ['function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'],
  await provider.getSigner(WHALE),
) as unknown as {
  transfer(to: string, value: bigint): Promise<ethers.ContractTransactionResponse>;
  balanceOf(account: string): Promise<bigint>;
};
await (await usdc.transfer(agent.address, 1_000_000_000n)).wait(); // 1,000 USDC
await provider.send('anvil_stopImpersonatingAccount', [WHALE]);

const usdcBalance = await usdc.balanceOf(agent.address);

console.log(`fork ready: chain ${net.chainId}, block ${await provider.getBlockNumber()}`);
console.log(`schema     ${record.schema}`);
console.log('');
console.log('--- give these to the client under test, and nothing else ---');
console.log(`AGENT_ADDRESS      ${agent.address}`);
console.log(`AGENT_PRIVATE_KEY  ${agent.privateKey}`);
console.log(`AGENT_USDC         ${ethers.formatUnits(usdcBalance, 6)}`);
console.log(`AGENT_ETH          ${ethers.formatEther(await provider.getBalance(agent.address))}`);
console.log('');
console.log('--- server side, not for the client ---');
console.log(`X402_PAY_TO        ${payTo.address}`);
console.log(`BASE_RPC_URL       ${RPC}`);
console.log(`EAS_SCHEMA_UID     ${SCHEMA_UID}`);
