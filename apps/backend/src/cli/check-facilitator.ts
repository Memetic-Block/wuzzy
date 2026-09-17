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
import { EVM_NETWORK_CHAIN_ID_MAP } from '@x402/evm/v1';

const config = buildPaymentConfig();
const url = config.facilitatorUrl;
const isCoinbase = url.startsWith('https://api.cdp.coinbase.com/');

// Every 402 quotes the network twice: by its v1 name and by its CAIP-2 id.
const chainId = (EVM_NETWORK_CHAIN_ID_MAP as Record<string, number>)[config.network];
if (chainId === undefined) {
  console.error(`\nX402_NETWORK must be an EVM network, got "${config.network}".`);
  process.exit(1);
}
const quoted = { 1: config.network, 2: `eip155:${chainId}` } as const;

console.log(`facilitator  ${url}`);
console.log(`network      ${quoted[1]} (x402 v1), ${quoted[2]} (x402 v2)`);

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

const body = (await response.json()) as {
  kinds?: { x402Version?: number; scheme?: string; network?: string }[];
};
const kinds = body.kinds ?? [];
const networks = [...new Set(kinds.map((k) => k.network ?? '?'))].sort();

// A kind is a version, a scheme and a network together. A facilitator can
// settle `exact` on a chain in one protocol version and not the other, and the
// public one at x402.org does exactly that for its testnets.
const settles = (version: 1 | 2) =>
  kinds.some(
    (k) => k.x402Version === version && k.scheme === 'exact' && k.network === quoted[version],
  );
const missing = ([1, 2] as const).filter((version) => !settles(version));

console.log(`\nnetworks     ${networks.join(', ')}`);
console.log(`exact v1     ${settles(1) ? 'yes' : 'NO'}`);
console.log(`exact v2     ${settles(2) ? 'yes' : 'NO'}`);

if (missing.length > 0) {
  // Both versions are offered in every 402, so a version this facilitator
  // cannot settle is a payer who signs and is then turned away.
  const versions = missing.map((version) => `v${version} on ${quoted[version]}`).join(' or ');
  const those = missing.length > 1 ? 'those versions' : 'that version';
  console.error(`\nThis facilitator cannot settle an exact payment in x402 ${versions}.`);
  console.error(`Every quote it backs in ${those} would be unpayable. Do not meter against it.`);
  process.exit(1);
}
console.log('\nOK: this facilitator can settle what we quote, in both versions.');
