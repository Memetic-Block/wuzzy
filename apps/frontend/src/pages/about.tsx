import { Fragment, h, type Children } from '@wuzzy/static-site';
import { Layout } from '../layout';
import { site } from '../site.config';

/**
 * The page that answers "who is this and why should I believe them".
 *
 * Quiet on purpose: one column, one measure, no case and no transcript. The
 * homepage argues by demonstration and this one argues in prose, so the only
 * things carried over are the type, the palette and the numbered rubrics that
 * make a section look like an entry in a ledger rather than a chapter.
 *
 * Every line is capped at 60ch. Berkeley Mono is a monospace face and its
 * lines run long at any comfortable size, so the measure is what keeps a
 * paragraph readable rather than the font size.
 */

const MEASURE = 'max-w-[60ch]';

const PRINCIPLES: readonly {
  title: string;
  body: string;
  link?: { label: string; href: string };
  rest?: string;
}[] = [
  {
    title: 'Receipts, not trust.',
    body: 'Every claim we make about the index is checkable — recompute our hashes, dispute them, read the protocol in ',
    link: { label: 'VERIFY.md', href: `${site.repo}/blob/master/VERIFY.md` },
    rest: '.',
  },
  {
    title: 'An honest crawler.',
    body: 'Transparent at the HTTP layer, always. We hide nothing about who we are.',
  },
  {
    title: 'No accounts.',
    body: 'A wallet is the only identity the system needs — for paying, for owning an index, for access control.',
  },
  {
    title: 'Hashes onchain, never content.',
    body: 'We attest commitments, not copies.',
  },
];

export default () => (
  <Layout title="About | Wuzzy">
    <article class="pb-16">
      <header class="border-rule border-b pt-11 pb-13">
        <h1
          class="text-h1 tracking-h1 mt-0 mb-[14px] max-w-[22ch] font-semibold"
          style="line-height:1.12"
        >
          About Wuzzy
        </h1>
        <p class={`text-ink-body ${MEASURE}`} style="line-height:1.6">
          Agents are becoming the web's biggest readers, and the retrieval they depend on is
          unverifiable: closed indexes, fed by crawlers that evade the sites they take from,
          rearrangeable by their operators without a trace. Wuzzy is provable, decentralized
          search — retrieval infrastructure where every result carries an onchain receipt: what
          was crawled, when, its content hash, attested on Base under a versioned public protocol
          anyone can replay and dispute.
        </p>
      </header>

      <Section marker="01 — HOW IT WORKS" title="How it works">
        <p class={`text-item text-ink-body m-0 ${MEASURE}`} style="line-height:1.6">
          You commission an index over sources you choose and pay per page in USDC — one x402
          payment, no account, no API key. We crawl honestly: our bot announces itself, respects
          robots.txt, and where a site posts a machine-access price, pays it or skips — never
          evades. Every fetched page is attested on Base, then queryable per-request. Commissioned
          crawls feed a shared, deduplicated document store, so coverage compounds from demand
          instead of crawl capital. The public Base-ecosystem index on our homepage is simply
          index #1.
        </p>
      </Section>

      <Section marker="02 — WHERE THIS COMES FROM" title="Where this comes from">
        <p class={`text-item text-ink-body m-0 ${MEASURE}`} style="line-height:1.6">
          The first Wuzzy ran on AO: crawler bots living onchain, waking on cron ticks to fetch,
          parse, and index autonomously.{' '}
          {/* Dropped whole rather than linked to nothing: an unverifiable claim
              about a public recording is worse than no claim at all. */}
          {site.podcastUrl ? (
            <>
              We described this vision publicly on{' '}
              <a href={site.podcastUrl} rel="noopener noreferrer">
                Forward Research's podcast
              </a>{' '}
              well before the current build.{' '}
            </>
          ) : null}
          Then the demand side arrived on its own: machine traffic surged against our index, unpaid
          and unmetered. The payment rail matured — agents now pay for search across the industry —
          but the receipts didn't. That's the part we're building.
        </p>
      </Section>

      <Section marker="03 — PRINCIPLES" title="Principles">
        {/* A ledger, like the steps on the homepage: hairline-ruled rows, each
            one a single claim that could be held against us. */}
        <dl class="border-rule m-0 border-t">
          {PRINCIPLES.map((principle) => (
            <div class="border-rule border-b py-3">
              <dt class="text-item font-semibold">{principle.title}</dt>
              <dd
                class={`text-item text-ink-body mt-1 ml-0 ${MEASURE}`}
                style="line-height:1.6"
              >
                {principle.body}
                {principle.link ? (
                  <a href={principle.link.href} rel="noopener noreferrer">
                    {principle.link.label}
                  </a>
                ) : null}
                {principle.rest}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section marker="04 — WHO BUILDS IT" title="Who builds it" last>
        <p class={`text-item text-ink-body m-0 ${MEASURE}`} style="line-height:1.6">
          Wuzzy is built by{' '}
          <a href={site.operator.href} rel="noopener noreferrer">
            {site.operator.name}
          </a>
          , a senior engineering guild that has shipped production decentralized infrastructure: a
          global onion-routing relay network, onchain naming on Base, and permanent-storage
          publishing systems.
        </p>
        {/* TODO(jim): individual bios or a team listing go here if we want
            them. Deliberately empty: naming people is a decision about who
            speaks for the project, not a gap for anyone else to fill in. */}
      </Section>

      {/* The page's one flourish. A 1.5px rule is the heaviest line in the
          design and it is spent once, here. */}
      <p
        class="border-ink text-h3 tracking-h3 mt-0 max-w-[46ch] border-t-[1.5px] pt-8 font-semibold"
        style="line-height:1.3"
      >
        The web's memory shouldn't depend on any single library staying standing. We're building an
        index that can't quietly burn.
      </p>

      <p class={`text-note text-ink-muted mt-10 ${MEASURE}`}>
        Contact:{' '}
        <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>
      </p>
    </article>
  </Layout>
);

/** A numbered rubric and a heading, the homepage's section shape at prose scale. */
const Section = ({
  marker,
  title,
  last,
  children,
}: {
  marker: string;
  title: string;
  last?: boolean;
  children?: Children;
}) => (
  <section class={`pt-13 pb-11${last ? '' : ' border-rule border-b'}`}>
    <div class="text-receipt tracking-marker text-ink-muted mb-[22px]">{marker}</div>
    <h2 class="text-h3 tracking-h3 mt-0 mb-[18px] font-semibold">{title}</h2>
    {children}
  </section>
);
