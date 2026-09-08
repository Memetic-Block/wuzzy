// Every value the site renders that is not prose, and the prose that is a
// claim about this deployment rather than a sentence.
//
// Prices, networks and endpoints live here because the page states them as
// fact. A number typed into markup is a number that goes stale the day the
// meter is reconfigured, and nothing catches it. Anything with a `null` here
// has not been published yet and renders as a stated absence, never as a dead
// link: the whole page is an argument that its claims are checkable.

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

/**
 * What a crawl of `pages` pages costs, by the same multiplication the meter
 * does. The commissioning examples quote real money, so the rate is read from
 * the same variable the backend prices with rather than written into the copy.
 */
export function priceForPages(pricePerPage: string, pages: number): string {
  const micros = Math.round(Number(pricePerPage.replace(/^\$/, '')) * 1_000_000) * pages;
  const dollars = micros / 1_000_000;
  // Whole dollars read as prices; fractions need the cents to look like one.
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
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
/** The per-page crawl rate, the same variable the backend prices commissions with. */
const pricePerPage = env.WUZZY_INDEX_PRICE_PER_PAGE ?? '$0.02';

export const site = {
  name: 'Wuzzy',
  origin: env.SITE_ORIGIN ?? 'https://wuzzy.io',
  apiOrigin: env.API_ORIGIN ?? 'https://api.wuzzy.io',
  docsOrigin: env.DOCS_ORIGIN ?? 'https://docs.wuzzy.io',

  /** Under the wordmark, lowercase, as a descriptor rather than a sentence. */
  wordmarkSubtitle: 'provable, decentralized search',

  tagline: 'Provable, decentralized search.',
  support:
    'Every result carries an onchain receipt — what was crawled, when, and proof nobody has rearranged it since.',

  description:
    'A search index for AI agents. Keyless and metered over x402, with onchain provenance on every result.',

  queryPrice,
  queryPriceAtomic: atomicUsdc(queryPrice),
  pricePerPage,
  network: env.X402_NETWORK ?? 'base',
  /** The same network as prose. "base-sepolia" is not a thing to put in a sentence. */
  networkLabel: networkLabel(env.X402_NETWORK ?? 'base'),
  /** The receiving address, once D4 produces it. Rendered as `0x…` until then. */
  payTo: env.X402_PAY_TO || null,
  /** USDC on Base. The meter derives this from the network; shown for accuracy. */
  asset: env.X402_ASSET ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',

  /** The protocol identifier attestations carry, and its version. */
  protocol: 'wuzzy/crawl-experimental',
  protocolVersion: 1,

  /**
   * Whether commissioning is actually reachable in production. While it is
   * false the Act 2 heading carries a SHIPPING THIS WEEK badge, which is a
   * promise with a date on it: remove the badge by setting this true the day
   * the creation flow goes live, not before, and not by deleting the markup.
   */
  indexCreationLive: env.INDEX_CREATION_LIVE === 'true',

  /**
   * The free, rate-limited human search box. Off by default: the agent
   * quickstart is the evidence a reviewer needs, and the box is garnish. The
   * backend half is gated separately by WEB_SEARCH_ENABLED, so turning this on
   * against an API that has it off renders a box that answers 404.
   */
  searchEnabled: env.SEARCH_ENABLED === 'true',

  searchPlaceholder: 'Try: how do I accept x402 payments?',

  /**
   * What the free box is actually searching. Named here rather than in the
   * markup because it describes a specific index the operator commissioned,
   * and it stops being true the day that changes.
   */
  searchCaption: {
    before: "You're searching ",
    emphasis: 'index #1',
    after:
      " — the Base ecosystem's documentation, commissioned and operated by us. Free for humans, rate-limited. Agents pay per query.",
  },

  /**
   * What the box searches on arrival, picked at random, so the case shows real
   * results with real provenance instead of an empty ledger. Every one was
   * checked against the corpus: a sample that returns nothing reads as a broken
   * product rather than as an empty index.
   */
  sampleQueries: [
    'deploy a smart contract',
    'account abstraction',
    'x402 payments',
    'gas estimation',
    'smart wallet',
    'onchain identity',
    'viem wallet client',
    'paymaster',
  ],

  /**
   * Where the box posts. Relative by default, because the site's own nginx
   * proxies /api to the free backend and a same-origin request needs no CORS.
   * A static host has no such proxy, so a Cloudflare Pages build sets this to
   * the API's absolute origin and the backend's WEB_SEARCH_ORIGINS has to name
   * this site. It is deliberately not derived from `apiOrigin`: that one points
   * at the metered API for the quickstart, and the box uses the free route.
   */
  webSearchUrl: env.WEB_SEARCH_URL ?? '/api/web-search',

  /**
   * The Forward Research podcast where the AO-era crawler was described.
   *
   * `null` until the link is to hand, and the about page drops the whole
   * sentence rather than shipping a link that goes nowhere: a claim about a
   * public recording is worth nothing if a reader cannot go and hear it.
   *
   * `podcastDate` is deliberately not rendered. The about page carries no
   * dates at all, and the copy dates the appearance in words instead ("well
   * before the current build"), which stays true without maintenance. It is
   * recorded here so the sentence can be checked against the actual episode.
   */
  podcastUrl: env.PODCAST_URL || null,
  podcastDate: env.PODCAST_DATE || null,

  /**
   * The dates at the top of the privacy policy and the terms. One pair for
   * both documents: they are revised together, and two literals in two files
   * is how one of them ends up a year stale without anyone noticing.
   *
   * `legalEffective` is when the agreement first bound anyone and does not
   * move for a revision. `legalUpdated` is what the policy's own "Changes to
   * This Policy" clause promises to bump, so it moves whenever the text does.
   */
  legalEffective: 'November 15, 2025',
  legalUpdated: 'September 7, 2026',

  // Three addresses, kept apart on purpose. `contactEmail` is the site's
  // general way in: the footer's "Contact" link and the about page. The other
  // two are named inside the privacy policy and the terms as the addresses
  // those documents undertake to receive notice at, so they are not a styling
  // choice and do not follow the site's front door when it moves.
  contactEmail: 'build@wuzzy.io',
  legalEmail: 'legal@wuzzy.io',
  dmcaEmail: 'dmca@wuzzy.io',

  repo: 'https://github.com/Memetic-Block/wuzzy',
  operator: { name: 'Memetic Block', href: 'https://memeticblock.com' },
  social: { label: 'x.com/wuzzysearch', href: 'https://x.com/wuzzysearch' },
} as const;

/** The four steps of commissioning, in the order they happen. */
export const COMMISSION_STEPS: readonly string[] = [
  'Send your seed URLs. The response is an HTTP 402 with the price for the pages they expand to.',
  'Pay it in USDC on Base — one x402 payment from any wallet.',
  'The crawl runs. A status endpoint reports pages fetched and attested.',
  'Query your index per-request, from the same wallet or anyone you allow.',
];

/**
 * The worked examples under the transcript. Page counts are illustrative and
 * say so ("~400 pages"); the prices next to them are not, and are multiplied
 * out from the configured rate so the page cannot quote a number the meter
 * would refuse to honour.
 */
export const COMMISSION_TICKETS: readonly { label: string; pages: number; suffix?: string }[] = [
  { label: "Your protocol's docs, ~400 pages", pages: 400, suffix: ', ready this afternoon' },
  { label: 'Every EIP your agent cites, ~900 pages', pages: 900 },
  { label: 'Docs for your whole dependency stack, ~1,500 pages', pages: 1500 },
];

/**
 * How a result proves itself, as three independent claims. A column may set a
 * literal command, which splits its sentence rather than ending it: the two
 * halves stay here so the whole sentence is readable in one place instead of
 * being reassembled in the markup.
 */
export interface ProofColumn {
  readonly title: string;
  readonly body: string;
  readonly code?: string;
  readonly rest?: string;
}

export const PROOF_COLUMNS: readonly ProofColumn[] = [
  {
    title: 'An honest crawler',
    body: 'WuzzyBot announces itself, respects robots.txt, and where a site posts a machine-access price, pays it or skips — never evades.',
  },
  {
    title: 'An attested fetch',
    body: "Each page's content hash, URL, and fetch time are attested on Base under a versioned public protocol.",
  },
  {
    title: 'A replayable claim',
    body: 'Anyone can recompute a hash from the live page and dispute ours — ',
    code: 'wuzzy verify <url>',
    rest: ' does it in one command.',
  },
];

/**
 * The five things a reviewer can go and check, addressed by name.
 *
 * Named here rather than inlined because two pages depend on them and must
 * not be able to disagree: the homepage renders them as a row, and the
 * roadmap decides from the very same values whether a claim is live or still
 * in build. One `null` moves an item between sections on one page and turns a
 * link into a stated absence on the other, from a single edit.
 */
const RECEIPT_HREFS = {
  easSchema: env.EAS_SCHEMA_URL || null,
  settledQuery: env.SETTLED_QUERY_URL || null,
  source: site.repo,
  verify: `${site.repo}/blob/master/VERIFY.md`,
  bazaar: env.BAZAAR_URL || null,
} as const;

/**
 * What a reviewer can click to check the claims above, in the order they
 * appear on the page. Two of these do not exist yet: the EAS schema is
 * registered by hand and the Bazaar listing is applied for. Filling one in is
 * an edit here and a rebuild; no markup changes.
 */
export const receipts: readonly Receipt[] = [
  {
    label: 'Attestation schema on Base',
    href: RECEIPT_HREFS.easSchema,
    note: 'The onchain schema every attestation is written against.',
  },
  {
    label: 'A settled query on Basescan',
    href: RECEIPT_HREFS.settledQuery,
    note: 'One metered query, paid and settled onchain.',
  },
  {
    label: 'Source on GitHub',
    href: RECEIPT_HREFS.source,
    note: 'The crawler, the canonicalizer, and the meter.',
  },
  {
    label: 'VERIFY.md',
    href: RECEIPT_HREFS.verify,
    note: 'The canonicalization procedure in prose, with conformance vectors.',
  },
  {
    label: 'x402 Bazaar listing',
    href: RECEIPT_HREFS.bazaar,
    note: 'Where an agent discovers this endpoint without being told about it.',
  },
];

/** A line on the roadmap. `receipt` is what makes it a status rather than a claim. */
export interface RoadmapItem {
  readonly name: string;
  readonly summary: string;
  /**
   * The proof the thing exists. An item is live exactly when this resolves to
   * a URL: the page does not carry a separate status field, because a status
   * and a receipt that could disagree is the failure this whole site argues
   * against.
   */
  readonly receipt?: { readonly label: string; readonly href: string | null };
}

/**
 * Things we say are done. Each one is listed with the receipt that proves it,
 * and an item whose receipt is not published yet is NOT shown as live: it
 * falls through to the in-build section on its own. Shipping something is
 * therefore setting one URL, never editing this list.
 */
const ROADMAP_CLAIMED: readonly RoadmapItem[] = [
  {
    name: 'Honest crawling',
    summary: 'WuzzyBot, robots respected, posted prices honored.',
    receipt: { label: 'VERIFY.md', href: RECEIPT_HREFS.verify },
  },
  {
    name: 'Attested fetches',
    summary: "every indexed page's hash committed on Base.",
    receipt: { label: 'attestation schema on easscan', href: RECEIPT_HREFS.easSchema },
  },
  {
    name: 'Metered search',
    summary: 'keyless, per-query, USDC on Base via x402.',
    receipt: { label: 'a settled query on Basescan', href: RECEIPT_HREFS.settledQuery },
  },
  {
    name: 'Open source',
    summary: 'the whole pipeline, contracts-first.',
    receipt: { label: 'GitHub', href: RECEIPT_HREFS.source },
  },
];

/** Work that has no receipt to give yet, and is not claiming otherwise. */
const ROADMAP_BUILDING: readonly RoadmapItem[] = [
  {
    name: 'Commissioned indexes',
    summary: 'pay to index sources you choose; public or private, one-shot or growing.',
    },
  {
    name: 'Free public search window',
    summary: 'rate-limited human access to index #1.',
  },
];

/** Live is a derived fact, not a stored one. */
export const roadmapLive: readonly RoadmapItem[] = ROADMAP_CLAIMED.filter(
  (item) => Boolean(item.receipt?.href),
);

/**
 * Anything claimed whose receipt has not landed, then the work that never
 * claimed one. Demoted items come first: they are the nearest to done, and
 * keeping their order preserves the reading of the section above.
 */
export const roadmapBuilding: readonly RoadmapItem[] = [
  ...ROADMAP_CLAIMED.filter((item) => !item.receipt?.href),
  ...ROADMAP_BUILDING,
];

/**
 * Direction, at one fixed resolution: what each phase makes harder to argue
 * with, and nothing about how. No architecture, no ecosystem names, and no
 * word that implies a date.
 */
export const ROADMAP_NEXT: readonly RoadmapItem[] = [
  {
    name: 'Verifiable compute',
    summary:
      'the canonicalization step as a pinned, replayable artifact on decentralized compute: verify the computation, not just the commitment.',
  },
  {
    name: 'Multi-vantage crawling',
    summary:
      'the same page fetched over independent network paths and cross-checked, making cloaking detectable and origin claims quorum-backed.',
  },
  {
    name: 'Permanent evidence',
    summary:
      'fetched content archived to permanent storage so every commitment stays openable in disputes, forever.',
  },
  {
    name: 'Index maturation',
    summary:
      'owner-set pricing, richer access policies, indexes that serve their own catalogs.',
  },
];
