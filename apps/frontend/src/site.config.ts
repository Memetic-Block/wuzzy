// Every value the site renders that is not prose.
//
// Two of these do not exist yet: the EAS schema is registered by hand and the
// Bazaar listing is applied for, and both land after this page is built. A
// `null` href renders as a stated pending note rather than as a dead link, so
// the receipts row is honest whether or not the value has arrived. Filling one
// in is an edit here and a rebuild; no markup changes.

/** A link in the receipts row. `href: null` means "not published yet". */
export interface Receipt {
  readonly label: string;
  readonly href: string | null;
  /** One line saying what a reviewer finds there, or why it is not there yet. */
  readonly note: string;
}

const env = process.env;

/**
 * USDC atomic units for a price the x402 helpers accept, e.g. "$0.01".
 *
 * The quickstart's payment ceiling has to be the same number the meter quotes,
 * and the meter derives it the same way from the same string. Six decimals is
 * USDC's, on Base as everywhere else.
 */
export function atomicUsdc(price: string): string {
  const parsed = Number(price.replace(/^\$/, ''));
  if (!Number.isFinite(parsed)) throw new Error(`X402_PRICE is not a price: "${price}"`);
  return String(Math.round(parsed * 1_000_000));
}

/** "base-sepolia" reads as "Base Sepolia" in a sentence, and as itself in JSON. */
function networkLabel(network: string): string {
  return network
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** The price the meter is configured with, never a number typed into copy. */
const queryPrice = env.X402_PRICE ?? '$0.01';

export const site = {
  name: 'Wuzzy',
  origin: env.SITE_ORIGIN ?? 'https://wuzzy.io',
  apiOrigin: env.API_ORIGIN ?? 'https://api.wuzzy.io',

  tagline:
    'A search index for AI agents, where every result carries onchain proof of what was crawled and when.',
  support:
    'Wuzzy crawls in the open, canonicalizes each page through a pinned public procedure, and attests the resulting hash on Base. Results carry the hash, so a paying agent can check what it bought instead of trusting us.',

  description:
    'A search index for AI agents. Keyless and metered over x402, with onchain provenance on every result.',

  queryPrice,
  queryPriceAtomic: atomicUsdc(queryPrice),
  network: env.X402_NETWORK ?? 'base',
  /** The same network as prose. "base-sepolia" is not a thing to put in a sentence. */
  networkLabel: networkLabel(env.X402_NETWORK ?? 'base'),
  /** The receiving address, once D4 produces it. Rendered as `0x...` until then. */
  payTo: env.X402_PAY_TO || null,
  /** USDC on Base. The meter derives this from the network; shown for accuracy. */
  asset: env.X402_ASSET ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',

  /** The protocol identifier attestations carry, and its version. */
  protocol: 'wuzzy/crawl-experimental',
  protocolVersion: 1,

  /**
   * The free, rate-limited human search box. Off by default: the agent
   * quickstart is the evidence a reviewer needs, and the box is garnish. The
   * backend half is gated separately by WEB_SEARCH_ENABLED, so turning this on
   * against an API that has it off renders a box that answers 404.
   */
  searchEnabled: env.SEARCH_ENABLED === 'true',

  // legal@ and dmca@ are the two addresses the legacy site published, so they
  // are the two known to exist. Point `contactEmail` at a friendlier alias once
  // there is one; it is the footer's "Contact" link and nothing else.
  contactEmail: 'legal@wuzzy.io',
  legalEmail: 'legal@wuzzy.io',
  dmcaEmail: 'dmca@wuzzy.io',

  repo: 'https://github.com/Memetic-Block/wuzzy',
  operator: { name: 'Memetic Block', href: 'https://memeticblock.com' },
  social: { label: 'x.com/wuzzysearch', href: 'https://x.com/wuzzysearch' },
} as const;

/**
 * What a reviewer can click to check the claims above, in the order they
 * appear on the page.
 */
export const receipts: readonly Receipt[] = [
  {
    label: 'Source',
    href: site.repo,
    note: 'The crawler, the canonicalizer, and the meter.',
  },
  {
    label: 'VERIFY.md',
    href: `${site.repo}/blob/master/VERIFY.md`,
    note: 'The canonicalization procedure in prose, with conformance vectors.',
  },
  {
    label: 'EAS schema',
    href: env.EAS_SCHEMA_URL || null,
    note: 'The onchain schema every attestation is written against.',
  },
  {
    label: 'x402 Bazaar',
    href: env.BAZAAR_URL || null,
    note: 'Where an agent discovers this endpoint without being told about it.',
  },
];
