import { Fragment, h } from '@wuzzy/static-site';
import { Check } from '../check';
import { Layout } from '../layout';
import { ROADMAP_NEXT, roadmapBuilding, roadmapLive, site, type RoadmapItem } from '../site.config';

/**
 * Status, with a section for direction. Not a promises page.
 *
 * Nothing here declares its own status. An item is live exactly when the
 * receipt that proves it resolves to a URL, and falls back into "in build" on
 * its own when it does not, so the page cannot claim something the site
 * cannot show you. Shipping is one URL in site.config, never an edit here.
 *
 * No dates, and no word that implies one. The ordering is the claim: this is
 * a sequence, not a schedule, and a sequence cannot slip.
 */

const MEASURE = 'max-w-[60ch]';

interface RoadmapSection {
  readonly title: string;
  readonly body: string;
}

export default () => {
  // An empty section collapses rather than showing filler, and the rubrics are
  // numbered from what actually rendered, so a collapse leaves no gap.
  // The runtime renders JSX to a string, so that is what a section body is.
  const sections: (RoadmapSection | null)[] = [
    roadmapLive.length ? { title: 'Live now', body: <Items items={roadmapLive} /> } : null,
    roadmapBuilding.length
      ? { title: 'In build', body: <Items items={roadmapBuilding} /> }
      : null,
    {
      title: 'Next: deeper receipts',
      body: (
        <>
          <p class={`text-item text-ink-body mt-0 mb-[18px] ${MEASURE}`} style="line-height:1.6">
            Every phase makes the receipts harder to argue with.
          </p>
          <Items items={ROADMAP_NEXT} />
        </>
      ),
    },
    { title: 'Demonstrated in v1', body: <FirstVersion /> },
  ];
  const shown = sections.filter((section): section is RoadmapSection => section !== null);

  return (
    <Layout title="Roadmap | Wuzzy">
      <article class="pb-16">
        <header class="border-rule border-b pt-11 pb-13">
          <h1
            class="text-h1 tracking-h1 mt-0 max-w-[22ch] font-semibold"
            style="line-height:1.12"
          >
            What's live, what's next
          </h1>
        </header>

        {shown.map((section, position) => (
          <section class={`pt-13 pb-11${position === shown.length - 1 ? '' : ' border-rule border-b'}`}>
            <div class="text-receipt tracking-marker text-ink-muted mb-[22px]">
              {String(position + 1).padStart(2, '0')} &mdash; {section.title.toUpperCase()}
            </div>
            <h2 class="text-h3 tracking-h3 mt-0 mb-[18px] font-semibold">{section.title}</h2>
            {section.body}
          </section>
        ))}
      </article>
    </Layout>
  );
};

/** Hairline-ruled rows, the same ledger shape the homepage's steps use. */
const Items = ({ items }: { items: readonly RoadmapItem[] }) => (
  <ul class="border-rule m-0 list-none border-t p-0">
    {items.map((item) => (
      <li class="border-rule border-b py-3">
        <p class={`text-item m-0 ${MEASURE}`} style="line-height:1.6">
          <span class="font-semibold">{item.name}</span>
          <span class="text-ink-body"> &mdash; {item.summary}</span>
        </p>
        {item.receipt?.href ? <Receipt receipt={item.receipt} /> : null}
      </li>
    ))}
  </ul>
);

/**
 * The homepage's receipt line, on a claim instead of on a result. Same type,
 * same greens, same spacing: a status here and a result there are the same
 * kind of assertion and should not look like different kinds.
 */
const Receipt = ({ receipt }: { receipt: NonNullable<RoadmapItem['receipt']> }) => (
  <div class="text-receipt text-ink-muted mt-1.5 flex flex-wrap gap-x-[14px] gap-y-1">
    <Check label="live" />
    <span>
      receipt:{' '}
      <a href={receipt.href!} rel="noopener noreferrer">
        {receipt.label}
      </a>
    </span>
  </div>
);

const FirstVersion = () => (
  <p class={`text-item text-ink-body m-0 ${MEASURE}`} style="line-height:1.6">
    The autonomous version of this system already ran: crawler processes living onchain, waking on
    cron ticks to fetch, parse, and index without an operator &mdash; built on AO, publicly
    demonstrated,{' '}
    {/* Linked only when there is somewhere to go. The phrase is part of the
        copy either way: dropping a clause to avoid a dead link would change
        what the sentence says. */}
    {site.podcastUrl ? (
      <a href={site.podcastUrl} rel="noopener noreferrer">
        vision on record
      </a>
    ) : (
      'vision on record'
    )}
    . The current build is its rebuild on production-grade rails.
  </p>
);
