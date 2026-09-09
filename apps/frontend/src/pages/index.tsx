import { escapeHtml, Fragment, h, type Children } from '@wuzzy/static-site';
import { Layout } from '../layout';
import { Check } from '../check';
import { transcript } from '../examples';
import {
  COMMISSION_STEPS,
  COMMISSION_TICKETS,
  PROOF_COLUMNS,
  priceForPages,
  receipts,
  site,
} from '../site.config';

/**
 * The homepage, in three acts: a working search with its receipts, the product
 * that sells more of them, and the proof that any of it is true.
 *
 * The order is the argument. A reader sees a real result with a real
 * attestation before being told what the product is, and is told what the
 * product is before being asked to believe the crawler is honest. Reversing
 * any two of those turns the page into a pitch.
 */
export default () => (
  <Layout title="Wuzzy">
    <Specimen />
    <Commission />
    <Proof />
  </Layout>
);

/** The numbered rubric above each act. Present on every section or on none. */
const Marker = ({ children }: { children?: Children }) => (
  <div class="text-receipt tracking-marker text-ink-muted mb-[22px]">{children}</div>
);

const Specimen = () => (
  <section class="border-rule border-b pt-11 pb-13">
    <Marker>01 &mdash; THE SPECIMEN</Marker>
    <h1 class="text-h1 tracking-h1 mt-0 mb-[14px] max-w-[22ch] font-semibold" style="line-height:1.12">
      {site.tagline}
    </h1>
    <p class="text-ink-body max-w-[58ch]" style="line-height:1.6">
      {site.support}
    </p>

    {site.searchEnabled ? <SpecimenCase /> : null}

    {/* The one promotional thing allowed up here, and it belongs to the act
        rather than to the box: the box is off by default, and a hero with
        nowhere to go from it is not the design either. */}
    <div class="mt-[18px]">
      <a
        href="#commission"
        class="border-accent text-accent text-prose tracking-wordmark hover:bg-accent hover:text-paper-raised inline-block border-[1.5px] px-4 py-[10px] font-medium no-underline"
      >
        Commission your own index &rarr;
      </a>
    </div>
  </section>
);

/**
 * The free box, as a bounded demonstration rather than a search engine.
 *
 * The case is a FIXED height, not a max height. A max height still grows from
 * two sample rows to five result rows, which shoves the commissioning and
 * proof sections down the page at the exact moment a reader is deciding
 * whether any of this is real. Fixed height costs some whitespace when the
 * results are short and buys a page that never moves under the reader. Only
 * the ledger scrolls; the input and both captions are chrome and stay put.
 *
 * There is no pagination. Five results is the demonstration; the full set is
 * what the metered API sells, and the tally line says so rather than inviting
 * a reader to page through a free endpoint.
 *
 * Off unless `SEARCH_ENABLED=true` at build time. It posts to /web-search, a
 * separate unmetered route, so nothing here touches the paid contract.
 */
const SpecimenCase = () => (
  <>
    {/* svh, not vh: on a phone `vh` is the height with the browser toolbars
        hidden, so the case grows as the reader scrolls and takes the whole
        page below it along. `svh` is measured with the toolbars shown and
        does not move. The vh declaration stays as the fallback for browsers
        that do not know the unit. */}
    <div
      class="border-ink bg-paper-raised mt-[30px] flex h-[34rem] flex-col overflow-hidden border-[1.5px]"
      style="max-height:80vh;max-height:80svh"
    >
      <div class="bg-ink text-paper text-marker tracking-marker flex justify-between gap-3 px-[14px] py-[7px]">
        <span>SPECIMEN CASE &middot; INDEX #1</span>
        {/* Revealed by search.js only once the ledger holds at least one real
            entry. An empty case under a LIVE badge is the page claiming
            evidence it does not have, which is the one failure this whole
            design argues against. */}
        <span id="ledger-live" class="text-accent-bright" hidden>
          LIVE
        </span>
      </div>

      <form
        id="search-form"
        data-endpoint={site.webSearchUrl}
        data-samples={site.sampleQueries.join('|')}
        data-commission="#commission"
        class="border-rule flex gap-2 border-b p-[14px]"
      >
        <input
          id="query"
          name="q"
          type="search"
          required
          autocomplete="off"
          aria-label="Search index #1"
          placeholder={site.searchPlaceholder}
          /* 16px below `sm`, then the design's 14px. Mobile Safari zooms the
             viewport when a focused field is smaller than 16px, which is the
             one thing on this page that can move the layout out from under a
             reader mid-search. */
          class="border-ink bg-field text-ink min-w-0 flex-1 rounded-none border-[1.5px] px-3 py-[10px] text-[16px] sm:text-item"
        />
        <button
          type="submit"
          class="border-ink bg-ink text-paper text-prose tracking-button hover:bg-accent hover:border-accent cursor-pointer rounded-none border-[1.5px] px-[18px] py-[10px] font-medium"
        >
          SEARCH
        </button>
      </form>

      <p class="border-rule text-note text-ink-body max-w-[74ch] border-b px-[14px] py-[11px]" style="line-height:1.55">
        {site.searchCaption.before}
        <strong class="text-ink font-semibold">{site.searchCaption.emphasis}</strong>
        {site.searchCaption.after}
      </p>

      <div class="border-rule bg-paper-sunk flex items-center justify-between gap-3 border-b px-[14px] py-1.5">
        <span id="ledger-caption" class="text-marker tracking-caption text-ink-muted">
          SAMPLE RESULTS &mdash; CAPTURED FROM THE LIVE API
        </span>
        {/* Hidden until the script that gives it meaning is running: a button
            that does nothing is worse than no button. Berkeley Mono has no
            refresh glyph, so this is a word rather than an icon. */}
        <button
          type="button"
          id="ledger-refresh"
          class="text-marker tracking-caption text-accent hover:text-ink cursor-pointer whitespace-nowrap disabled:opacity-40"
          hidden
        >
          NEW SAMPLE
        </button>
      </div>

      {/* The only thing on the page that scrolls. */}
      <div id="ledger" class="ledger-scroll min-h-0 flex-1 overflow-y-auto"></div>

      {/* The one definition of the attested mark. search.js reads its markup
          rather than carrying a second copy, so the ledger and the roadmap
          cannot end up drawing different ticks. */}
      <template id="attested-mark">
        <Check label="attested" />
      </template>
    </div>

    <script src="/search.js" defer></script>
  </>
);

const Commission = () => (
  <section id="commission" class="border-rule border-b pt-13 pb-14">
    <Marker>02 &mdash; THE PRODUCT</Marker>
    <div class="mb-[14px] flex flex-wrap items-baseline gap-3">
      <h2 class="text-h2 tracking-h2 m-0 font-semibold" style="line-height:1.15">
        Commission your own index.
      </h2>
      {/* Gated on the creation flow being reachable in production, not on
          someone remembering to delete it. */}
      {site.indexCreationLive ? null : (
        <span class="text-marker tracking-caption border-pending text-pending border px-[7px] py-[3px] whitespace-nowrap">
          SHIPPING THIS WEEK
        </span>
      )}
    </div>
    <p class="text-ink-body m-0 max-w-[60ch]" style="line-height:1.6">
      Point Wuzzy at any sources. We crawl them honestly &mdash; robots respected, posted prices
      paid or skipped, never evaded &mdash; and attest every page on Base. Queryable in about an
      hour. No account, no API key: a wallet is enough.
    </p>

    <ol class="border-rule mt-7 mb-0 grid list-none border-t p-0">
      {COMMISSION_STEPS.map((step, position) => (
        <li class="border-rule flex gap-[14px] border-b py-3">
          <span class="text-accent text-step min-w-[2ch] pt-0.5 font-semibold">
            {String(position + 1).padStart(2, '0')}
          </span>
          <span class="text-item max-w-[62ch]" style="line-height:1.6">
            {step}
          </span>
        </li>
      ))}
    </ol>

    <Transcript />

    {/* Worked examples. The page counts are approximate and say so; the prices
        are multiplied out from the rate the meter is configured with. */}
    <div class="mt-6 grid gap-2">
      {COMMISSION_TICKETS.map((ticket) => (
        <div class="border-rule-dashed bg-paper-raised text-prose-lg flex flex-wrap justify-between gap-4 border border-dashed px-[14px] py-3">
          <span>{ticket.label}</span>
          <span class="text-accent font-medium whitespace-nowrap">
            &asymp; {priceForPages(site.pricePerPage, ticket.pages)}
            {ticket.suffix}
          </span>
        </div>
      ))}
    </div>

    <p class="text-ink-body text-item mt-6 mb-0 max-w-[60ch]" style="line-height:1.6">
      Pages already in the shared store join your index instantly at the same price &mdash;
      coverage compounds from demand, and every page keeps its original receipt.
    </p>
  </section>
);

/**
 * The 402 handshake, captured rather than composed. The status line is the one
 * coloured thing in the block because it is the whole point of the exchange.
 */
const Transcript = () => (
  <div class="border-ink bg-terminal mt-7 overflow-hidden border-[1.5px]">
    <div class="border-terminal-rule text-marker tracking-terminal text-terminal-label flex justify-between gap-3 border-b px-[14px] py-1.5">
      <span>{transcript.label}</span>
      <span>{transcript.origin}</span>
    </div>
    <pre class="text-note text-terminal-text m-0 overflow-x-auto px-[14px] py-4" style="line-height:1.75">
      <code>
        {escapeHtml(transcript.request)}
        {'\n\n'}
        <span class="text-terminal-status">{escapeHtml(transcript.status)}</span>
        {'\n'}
        {escapeHtml(transcript.body)}
        {'\n\n'}
        {escapeHtml(transcript.next)}
      </code>
    </pre>
  </div>
);

const Proof = () => (
  <section class="pt-13 pb-11">
    <Marker>03 &mdash; THE PROOF</Marker>
    <h2 class="text-h3 tracking-h3 mt-0 mb-[26px] font-semibold">How a result proves itself.</h2>

    <div class="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))]">
      {PROOF_COLUMNS.map((column) => (
        <div class="border-ink border-t pt-3">
          <div class="text-prose-lg mb-1.5 font-semibold">{column.title}</div>
          {/* The runtime does not escape children, and the command contains a
              literal <url> placeholder that would otherwise be parsed as a tag
              and vanish from the page. */}
          <p class="text-prose text-ink-body m-0" style="line-height:1.6">
            {column.body}
            {column.code ? (
              <code class="bg-rule-soft px-1 py-px">{escapeHtml(column.code)}</code>
            ) : null}
            {column.rest}
          </p>
        </div>
      ))}
    </div>

    <div class="mt-8 flex flex-wrap gap-2">
      {receipts.filter((receipt) => receipt.href).map((receipt) => (
        <ReceiptChip receipt={receipt} />
      ))}
    </div>
  </section>
);

/**
 * Only receipts that resolve are shown.
 *
 * This row is the page's evidence, and an entry a reviewer cannot click is a
 * promise sitting among proofs, which costs more credibility than the missing
 * item was worth. An absence is still stated, just not here: the roadmap is
 * where something not yet published is named, with the receipt that will prove
 * it. Setting the URL in the configuration brings the entry back with no markup
 * change, which is what makes dropping it safe rather than a deletion.
 */
const ReceiptChip = ({ receipt }: { receipt: (typeof receipts)[number] }) => (
  <a
    href={receipt.href ?? undefined}
    title={receipt.note}
    rel="noopener noreferrer"
    class="border-rule-strong bg-paper-raised text-note text-ink-body hover:border-accent hover:text-accent border px-3 py-2 no-underline"
  >
    {receipt.label}
  </a>
  );
