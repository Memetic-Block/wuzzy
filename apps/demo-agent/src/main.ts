#!/usr/bin/env bun
/**
 * A paying client for Wuzzy. This is the whole integration: a wallet, a fetch
 * wrapper, and a POST. No account, no API key, no signup.
 *
 *   bun run demo wallet
 *   bun run demo search "how do I deploy a contract to Base"
 */
import {
  appendToIndex,
  commissionIndex,
  indexStatus,
  listIndexes,
  NotPermittedError,
  PageCapError,
  type CommissionOutcome,
  type IndexStatus,
} from './indexes';
import { basescanUrl, paidSearch, WalletRequiredError, type SearchOutcome } from './search';
import { createWallet, loadWallet, NoWalletError, walletPath } from './wallet';

const USAGE = `wuzzy demo agent

  demo wallet                 create a fresh wallet and print its address
  demo search "<query>"       pay for one query and print the results

  demo indexes                list the public index catalog (free)
  demo commission <url>...    pay per page for an index of your own
  demo append <index> <url>...  add pages to an index you own
  demo status <index>         how far along an index is (free)

  --endpoint=<url>            default https://wuzzy.io/search, or WUZZY_ENDPOINT
  --network=<base|base-sepolia>
  --top=<n>                   results to request (default 5)
  --index=<id|slug>           search one index instead of the global one
  --name=<text>               name for a commissioned index
  --private                   commission it unlisted, readable by an allowlist
  --reader=<0x...>            allow another wallet to read it (repeatable)
`;

function renderIndex(index: IndexStatus): void {
  console.log(`\n${index.name}  (${index.slug})`);
  console.log(`   id      ${index.id}`);
  console.log(`   owner   ${index.owner}`);
  console.log(`   access  ${index.visibility} / ${index.readPolicy}`);
  console.log(`   status  ${index.status}  ${index.pages} page(s), ${index.pending} pending`);
  console.log(`   proof   ${index.attestations} of ${index.pages} attested onchain`);
}

function renderSettlement(outcome: CommissionOutcome, network: string): void {
  if (!outcome.paid) {
    console.log('\nserved without payment: the endpoint is in dev mode');
    return;
  }
  const transaction = outcome.settlement?.transaction;
  console.log(
    transaction
      ? `\nsettled onchain: ${basescanUrl(transaction, outcome.settlement?.network ?? network)}`
      : '\npayment settled (no transaction hash returned)',
  );
}

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
  const flags = (name: string): string[] =>
    rest.filter((arg) => arg.startsWith(`--${name}=`)).map((arg) => arg.slice(name.length + 3));
  const has = (name: string): boolean => rest.includes(`--${name}`);
  const positional = rest.filter((arg) => !arg.startsWith('--'));
  const network = (flag('network') ?? 'base') as 'base' | 'base-sepolia';
  const endpoint = flag('endpoint') ?? process.env.WUZZY_ENDPOINT ?? 'https://wuzzy.io/search';

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

  // Reading the catalog and an index's progress costs nothing, so neither
  // needs a wallet.
  if (command === 'indexes') {
    const catalog = await listIndexes(endpoint);
    if (catalog.length === 0) console.log('no public indexes');
    for (const index of catalog) {
      console.log(`${index.slug.padEnd(24)} ${index.readPolicy.padEnd(10)} ${index.name}`);
    }
    return 0;
  }

  if (command === 'status') {
    const reference = positional[0];
    if (!reference) {
      console.error('status needs an index id or slug');
      return 1;
    }
    renderIndex(await indexStatus(endpoint, reference));
    return 0;
  }

  if (command === 'commission' || command === 'append') {
    return commission(command, positional, { endpoint, network, flag, flags, has });
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
  console.log(`querying  ${endpoint}${flag('index') ? ` (index ${flag('index')})` : ''}`);

  let outcome;
  try {
    outcome = await paidSearch({
      endpoint,
      query,
      privateKey: wallet?.privateKey,
      network,
      topK: Number(flag('top') ?? 5),
      index: flag('index'),
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

/**
 * Commissioning and appending are the same shape: a wallet, a list of URLs, a
 * per-page price quoted in the 402. Appending additionally requires that the
 * wallet be the index's owner, which the API checks before it settles, so a
 * wallet that is turned away is not charged for finding out.
 */
async function commission(
  command: 'commission' | 'append',
  positional: readonly string[],
  context: {
    endpoint: string;
    network: 'base' | 'base-sepolia';
    flag: (name: string) => string | undefined;
    flags: (name: string) => string[];
    has: (name: string) => boolean;
  },
): Promise<number> {
  const { endpoint, network, flag, flags, has } = context;
  const [reference, ...urls] = command === 'append' ? positional : ['', ...positional];

  if (command === 'append' && !reference) {
    console.error('append needs an index id or slug, then URLs');
    return 1;
  }
  if (urls.length === 0) {
    console.error(`${command} needs at least one URL`);
    return 1;
  }

  // Unlike a search, this always needs a wallet even against a dev-mode
  // endpoint: an index has an owner, and there is nobody to be one without it.
  let wallet;
  try {
    wallet = await loadWallet();
  } catch (error) {
    if (!(error instanceof NoWalletError)) throw error;
    console.error(`an index has an owner, so ${command} needs a wallet:`);
    console.error('  bun run demo wallet');
    return 1;
  }

  console.log(`paying as ${wallet.address}`);
  console.log(`${command === 'append' ? 'appending to' : 'commissioning'} ${urls.length} page(s)`);

  const readers = flags('reader');
  // Naming a reader implies privacy: an allowlist on a listed, open index
  // would be decoration rather than a policy.
  const isPrivate = has('private') || readers.length > 0;

  try {
    const outcome =
      command === 'append'
        ? await appendToIndex({
            api: endpoint,
            index: reference!,
            urls,
            privateKey: wallet?.privateKey,
            network,
          })
        : await commissionIndex({
            api: endpoint,
            urls,
            name: flag('name'),
            visibility: isPrivate ? 'unlisted' : undefined,
            readPolicy: isPrivate ? 'allowlist' : undefined,
            allowlist: readers,
            privateKey: wallet?.privateKey,
            network,
            owner: wallet?.address,
          });

    renderIndex(outcome.index);
    renderSettlement(outcome, network);
    if (outcome.index.pending > 0) {
      console.log(`\nWatch it fill:  bun run demo status ${outcome.index.slug}`);
    }
    return 0;
  } catch (error) {
    if (error instanceof PageCapError || error instanceof NotPermittedError) {
      console.error(`\n${error.message}`);
      return 1;
    }
    throw error;
  }
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)));
}

export { main };
