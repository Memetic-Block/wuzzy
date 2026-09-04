#!/usr/bin/env bun
/**
 * A paying client for Wuzzy. This is the whole integration: a wallet, a fetch
 * wrapper, and a POST. No account, no API key, no signup.
 *
 *   bun run demo wallet
 *   bun run demo search "how do I deploy a contract to Base"
 */
import { basescanUrl, paidSearch, WalletRequiredError, type SearchOutcome } from './search';
import { createWallet, loadWallet, NoWalletError, walletPath } from './wallet';

const USAGE = `wuzzy demo agent

  demo wallet                 create a fresh wallet and print its address
  demo search "<query>"       pay for one query and print the results

  --endpoint=<url>            default https://wuzzy.io/search, or WUZZY_ENDPOINT
  --network=<base|base-sepolia>
  --top=<n>                   results to request (default 5)
`;

function render(outcome: SearchOutcome, network: string): void {
  if (outcome.results.length === 0) {
    console.log('no results');
    return;
  }

  for (const [index, result] of outcome.results.entries()) {
    console.log(`\n${index + 1}. ${result.title ?? '(untitled)'}`);
    console.log(`   ${result.url}`);
    console.log(`   score ${result.score.toFixed(4)}`);
    console.log(`   ${result.snippet}`);
    const { protocol, protocolVersion, contentHash, fetchedAt } = result.provenance;
    console.log(`   provenance  ${protocol} v${protocolVersion}  fetched ${fetchedAt}`);
    console.log(`   contentHash ${contentHash}`);
    console.log(
      result.provenance.attestationUrl
        ? `   attestation ${result.provenance.attestationUrl}`
        : '   attestation not yet onchain',
    );
  }

  console.log('');
  if (!outcome.paid) {
    console.log('served without payment: the endpoint is in dev mode');
    return;
  }
  const transaction = outcome.settlement?.transaction;
  console.log(
    transaction
      ? `settled onchain: ${basescanUrl(transaction, outcome.settlement?.network ?? network)}`
      : 'payment settled (no transaction hash returned)',
  );
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const flag = (name: string): string | undefined =>
    rest.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const positional = rest.filter((arg) => !arg.startsWith('--'));

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  if (command === 'wallet') {
    const wallet = await createWallet();
    console.log(`created ${wallet.address}`);
    console.log(`stored  ${walletPath()} (mode 0600, outside the repository)`);
    console.log('\nFund it with a little USDC on Base, then run:');
    console.log('  bun run demo search "how do I deploy a contract to Base"');
    return 0;
  }

  if (command !== 'search') {
    console.error(`unknown command "${command}"\n\n${USAGE}`);
    return 1;
  }

  const query = positional.join(' ').trim();
  if (query === '') {
    console.error('search needs a query');
    return 1;
  }

  const network = (flag('network') ?? 'base') as 'base' | 'base-sepolia';
  const endpoint = flag('endpoint') ?? process.env.WUZZY_ENDPOINT ?? 'https://wuzzy.io/search';

  let wallet;
  try {
    wallet = await loadWallet();
  } catch (error) {
    if (!(error instanceof NoWalletError)) throw error;
    // Not fatal yet: a dev-mode endpoint serves without payment, so find out
    // before demanding a funded key.
    wallet = undefined;
  }

  console.log(wallet ? `paying as ${wallet.address}` : 'no wallet: trying unpaid first');
  console.log(`querying  ${endpoint}`);

  let outcome;
  try {
    outcome = await paidSearch({
      endpoint,
      query,
      privateKey: wallet?.privateKey,
      network,
      topK: Number(flag('top') ?? 5),
    });
  } catch (error) {
    if (error instanceof WalletRequiredError) {
      console.error(`\n${error.message}`);
      console.error('  bun run demo wallet');
      return 1;
    }
    throw error;
  }
  render(outcome, network);
  return 0;
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)));
}

export { main };
