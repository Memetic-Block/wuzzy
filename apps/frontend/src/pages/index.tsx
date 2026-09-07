import { escapeHtml, h, type Children } from '@wuzzy/static-site';
import { Layout } from '../layout';
import { receipts, site } from '../site.config';

const QUERY = 'how do I deploy a contract to Base';
const BODY = `{"query":"${QUERY}","topK":3}`;
const ENDPOINT = `${site.apiOrigin}/search`;

/**
 * The 402 handshake, written out rather than described.
 *
 * Every field name here is the one the meter actually emits, and the amount is
 * derived from the configured price rather than typed in, so a price change
 * cannot leave a stale number on the page. `payTo` is the receiving address
 * once it exists and an ellipsis until then, because a placeholder address
 * that looked real would be the one thing on this page a reader could not
 * check.
 */
const UNPAID = `$ curl -sS -X POST ${ENDPOINT} \\
    -H 'content-type: application/json' \\
    -d '${BODY}'

HTTP/1.1 402 Payment Required

{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "${site.network}",
      "maxAmountRequired": "${site.queryPriceAtomic}",
      "resource": "${ENDPOINT}",
      "description": "One Wuzzy search query with onchain provenance",
      "payTo": "${site.payTo ?? '0x...'}",
      "asset": "${site.asset}",
      "maxTimeoutSeconds": 60,
      "mimeType": "application/json"
    }
  ]
}`;

const PAID = `# Sign the authorization above with your wallet, base64 it, and retry.
$ curl -sS -X POST ${ENDPOINT} \\
    -H 'content-type: application/json' \\
    -H "X-PAYMENT: $PAYMENT" \\
    -d '${BODY}'

HTTP/1.1 200 OK
X-PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLCJ0cmFuc2FjdGlvbiI6IjB4...

{
  "query": "${QUERY}",
  "index": "global",
  "results": [
    {
      "url": "https://docs.base.org/get-started/deploy-smart-contracts",
      "title": "Deploy a smart contract",
      "snippet": "Deploying a contract to Base requires a funded wallet and a...",
      "score": 0.0323,
      "provenance": {
        "protocol": "${site.protocol}",
        "protocolVersion": ${site.protocolVersion},
        "contentHash": "b3f1c0...9ad4",
        "fetchedAt": "2026-02-01T00:00:00.000Z",
        "attestationUid": "0xe3a7...41bc",
        "attestationUrl": "https://base.easscan.org/attestation/view/0xe3a7...41bc"
      }
    }
  ]
}`;

const ONE_COMMAND = `$ npx awal@latest x402 pay ${ENDPOINT} \\
    -X POST \\
    -d '${BODY}' \\
    --max-amount ${site.queryPriceAtomic}`;

const HOW_IT_VERIFIES = [
  {
    title: 'Honest crawler',
    body: `WuzzyBot says who it is on every request, reads robots.txt as WuzzyBot rather than as
      a wildcard, and honors it or skips the page. No stealth, no fingerprint evasion, no proxy
      rotation, ever.`,
  },
  {
    title: 'Attested fetch',
    body: `Each page is canonicalized by a pinned, published procedure and the resulting hash is
      attested on Base. Only hashes and metadata go onchain, never content. A procedure is
      identified by protocol and version together, so a change is a new version, not a rewrite.`,
  },
  {
    title: 'Replay it yourself',
    body: `Re-fetch the URL, run it through the same procedure, and compare. VERIFY.md is the
      procedure in prose with conformance vectors, so a verifier can be written without reading
      our source.`,
  },
];

export default () => (
  <Layout title="Wuzzy">
    <h1 class="text-3xl leading-tight font-bold normal-case">{site.tagline}</h1>
    <p class="text-ink-muted mt-4 leading-relaxed">{site.support}</p>

    {site.searchEnabled ? <SearchBox /> : null}

    <Section id="quickstart" title="Agent quickstart">
      <p class="leading-relaxed">
        There is no account and no API key. Ask, get a 402 with the price, pay, and ask again. One
        query costs {site.queryPrice} in USDC on {site.networkLabel}.
      </p>

      <Code label="1. Ask without paying" text={UNPAID} />
      <Code label="2. Pay and retry" text={PAID} />

      <p class="mt-8 leading-relaxed">
        Or let a client do the handshake. Any x402 client works; this is the Coinbase agentic
        wallet CLI:
      </p>
      <Code label="The same thing, one command" text={ONE_COMMAND} />
    </Section>

    <Section title="Receipts">
      <p class="leading-relaxed">Everything above is checkable. Start here:</p>
      <ul class="mt-4 space-y-3">
        {receipts.map((receipt) => (
          <li class="border-ink border-l-2 pl-4">
            {receipt.href ? (
              <a href={receipt.href} target="_blank" rel="noopener noreferrer" class="font-bold underline">
                {receipt.label}
              </a>
            ) : (
              <span class="font-bold">
                {receipt.label} <span class="text-ink-muted font-normal">(published at cutover)</span>
              </span>
            )}
            <span class="text-ink-muted block text-sm">{receipt.note}</span>
          </li>
        ))}
      </ul>
    </Section>

    <Section title="How it verifies">
      <ol class="space-y-6">
        {HOW_IT_VERIFIES.map((item, position) => (
          <li>
            <h3 class="font-bold">
              {position + 1}. {item.title}
            </h3>
            <p class="text-ink-muted mt-1 leading-relaxed">{item.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  </Layout>
);

const Section = ({ id, title, children }: { id?: string; title: string; children?: Children }) => (
  <section id={id} class="mt-16">
    <h2 class="border-ink mb-6 border-b-2 pb-2 text-base font-bold">{title}</h2>
    {children}
  </section>
);

/**
 * Children are not escaped by the JSX runtime, so code samples go through
 * `escapeHtml` explicitly rather than relying on none of them ever containing
 * an angle bracket.
 */
const Code = ({ label, text }: { label: string; text: string }) => (
  <figure class="mt-6">
    <figcaption class="text-ink-muted mb-1 text-sm">{label}</figcaption>
    <pre class="bg-paper-alt overflow-x-auto p-4 text-xs leading-relaxed">
      <code>{escapeHtml(text)}</code>
    </pre>
  </figure>
);

/**
 * The free box, as a bounded demo rather than a search engine.
 *
 * The case is a FIXED height, not a max height. A max height still grows from
 * two sample rows to five result rows, which shoves the commissioning and
 * proof sections down the page at the exact moment a reader is deciding
 * whether any of this is real. Fixed height costs some whitespace when the
 * results are short and buys a page that never moves under the reader.
 *
 * There is no pagination. Five results is the demonstration; the full set is
 * what the metered API sells, and the footer line says so rather than
 * inviting a reader to page through a free endpoint.
 *
 * Off unless `SEARCH_ENABLED=true` at build time. It posts to /web-search,
 * a separate unmetered route, so nothing here touches the paid contract.
 */
const SearchBox = () => (
  <section class="mt-12">
    <div class="border-ink flex h-[34rem] flex-col border-2">
      {/* Head stays put: scrolling results must never take the input with them. */}
      <div class="border-ink border-b-2 p-4">
        <form
          id="search-form"
          data-endpoint={site.webSearchUrl}
          data-samples={site.sampleQueries.join('|')}
          data-commission={`${site.docsOrigin}/guide/indexes`}
          class="flex flex-wrap gap-2"
        >
          <input
            id="query"
            name="query"
            required
            autocomplete="off"
            placeholder="Search the Base docs"
            class="border-ink min-w-0 flex-1 border-2 px-3 py-2"
          />
          <button
            type="submit"
            class="border-ink bg-ink text-paper cursor-pointer border-2 px-4 py-2"
          >
            Search
          </button>
        </form>
        <p class="text-ink-muted mt-3 text-sm">{site.searchCaption}</p>
      </div>

      {/* The only thing that scrolls. */}
      <div class="flex-1 overflow-y-auto p-4">
        <p id="results-caption" class="text-ink-muted mb-4 text-sm">
          Sample results &mdash; captured from the live API
        </p>
        <div id="results"></div>
        <p id="results-more" class="text-ink-muted mt-4 text-sm" hidden></p>
      </div>
    </div>

    {/* The one promotional thing allowed near the search. */}
    <p class="mt-4">
      <a
        href={`${site.docsOrigin}/guide/indexes`}
        class="border-ink bg-ink text-paper inline-block border-2 px-4 py-2 no-underline"
      >
        Commission your own index
      </a>
    </p>

    <script src="/search.js" defer></script>
  </section>
);
