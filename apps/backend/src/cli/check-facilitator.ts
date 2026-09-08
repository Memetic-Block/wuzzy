/**
 * Checks that the configured facilitator can settle the network we meter on,
 * using the credentials this deployment actually holds.
 *
 *   X402_CDP_API_KEY_ID=... X402_CDP_API_KEY_SECRET=... \
 *     bun apps/backend/src/cli/check-facilitator.ts
 *
 * Worth running before anything that spends money. Two failures it catches
 * cheaply, both of which otherwise surface as a payer being turned away:
 * credentials that do not work, and a facilitator that does not cover the
 * chain. The second is not hypothetical: the public endpoint at x402.org
 * answers with base-sepolia and other testnets and no eip155:8453, and it was
 * this project's default until it was checked.
 *
 * Reads credentials from the environment and never prints them.
 */
import { buildPaymentConfig } from '../payment/payment.config';
import { createFacilitatorConfig } from '@coinbase/x402';

const config = buildPaymentConfig();
const url = config.facilitatorUrl;
const isCoinbase = url.startsWith('https://api.cdp.coinbase.com/');

console.log(`facilitator  ${url}`);
console.log(`network      ${config.network}`);

let headers: Record<string, string> = {};
if (isCoinbase) {
  if (!config.cdpApiKeyId || !config.cdpApiKeySecret) {
    console.error('\nX402_CDP_API_KEY_ID and X402_CDP_API_KEY_SECRET are not set.');
    process.exit(1);
  }
  const cdp = createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret);
  const signed = (await cdp.createAuthHeaders?.()) ?? {};
  headers = signed.supported ?? {};
  console.log(`credentials  present, id ends ...${config.cdpApiKeyId.slice(-4)}`);
}

// An unreachable facilitator is the same class of problem as a wrong one, and
// a stack trace from inside fetch says less than the URL that failed.
const response = await fetch(`${url}/supported`, { headers }).catch((error: Error) => {
  console.error(`\nCould not reach ${url}: ${error.message}`);
  process.exit(1);
});
if (!response.ok) {
  console.error(`\n${response.status} ${response.statusText} from /supported.`);
  console.error(
    response.status === 401
      ? 'The credentials were rejected. Check the key id and secret.'
      : await response.text().then((t) => t.slice(0, 200)),
  );
  process.exit(1);
}

const body = (await response.json()) as { kinds?: { scheme?: string; network?: string }[] };
const kinds = body.kinds ?? [];
const networks = [...new Set(kinds.map((k) => k.network ?? '?'))].sort();

// Base mainnet appears either as its CAIP-2 id or by name, depending on which
// version of the protocol the facilitator answers with.
const MAINNET = ['eip155:8453', 'base'];
const settlesBase = networks.some((n) => MAINNET.includes(n));
const exactOnBase = kinds.some((k) => k.scheme === 'exact' && MAINNET.includes(k.network ?? ''));

console.log(`\nnetworks     ${networks.join(', ')}`);
console.log(`base mainnet ${settlesBase ? 'yes' : 'NO'}`);
console.log(`exact scheme ${exactOnBase ? 'yes' : 'NO'}`);

if (!settlesBase || !exactOnBase) {
  console.error('\nThis facilitator cannot settle an exact payment on Base mainnet.');
  console.error('Every quote it backs would be unpayable. Do not meter against it.');
  process.exit(1);
}
console.log('\nOK: this facilitator can settle what we quote.');
