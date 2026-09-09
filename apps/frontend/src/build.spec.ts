import { afterAll, describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildAll } from '../build';
import capture from '../../../fixtures/examples/indexes-402.json';
import { COMMISSION_TICKETS, priceForPages, receipts, site } from './site.config';

const appDir = join(import.meta.dir, '..');
const distDir = join(appDir, 'dist');

const read = (file: string) => Bun.file(join(distDir, file)).text();
const exists = (file: string) => Bun.file(join(distDir, file)).exists();

/**
 * The text of every code block on a page, with entities decoded.
 *
 * The samples are escaped on the way in, so asserting on the raw HTML would
 * check the escaping rather than the sample. Reading them back decoded also
 * pins that the quickstart is in a code block at all.
 */
const codeSamples = (html: string): string =>
  [...html.matchAll(/<code>([\s\S]*?)<\/code>/g)]
    .map((match) => match[1]!)
    .join('\n')
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

/** A page's visible text, tags stripped and whitespace collapsed. */
const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replace(/\s+/g, ' ')
    .trim();

/** The item names listed under one roadmap section, by its rubric title. */
const sectionItems = (html: string, title: string): string[] => {
  // Bun's JSX transpiler decodes entities in JSX text, so the rendered
  // rubric carries a literal em dash and never the `&mdash;` written in
  // the source. Matching the entity here silently finds nothing.
  const start = html.indexOf(`\u2014 ${title}<`);
  if (start === -1) return [];
  const list = /<ul[\s\S]*?<\/ul>/.exec(html.slice(start))?.[0] ?? '';
  return [...list.matchAll(/<span class="font-semibold">([^<]+)<\/span>/g)].map((m) => m[1]!);
};

/** Leaves dist as the default build, whatever a test built into it. */
afterAll(async () => {
  await buildAll();
});

describe('static build', () => {
  it('pre-renders every page to dist', async () => {
    const written = await buildAll();
    expect(written.length).toBeGreaterThan(0);

    const index = await read('index.html');
    expect(index).toStartWith('<!doctype html>');
    expect(index).toContain('<title>Wuzzy</title>');
    expect(await exists('privacy.html')).toBe(true);
    expect(await exists('terms.html')).toBe(true);

    // Assets are content-addressed and the page points at the hashed names, so
    // a long-cached browser cannot keep running a previous build's script.
    const assets = [...index.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]!);
    expect(assets).toEqual(
      expect.arrayContaining([expect.stringMatching(/^\/styles\.[0-9a-f]{8}\.css$/)]),
    );

    // Every one of them resolves: the unhashed originals are gone, so a missed
    // rewrite would be a 404 rather than a stale file.
    for (const asset of assets) {
      expect(await exists(asset)).toBe(true);
    }
    expect(await exists('styles.css')).toBe(false);

    // Tailwind compiled and picked up classes used in the pages.
    const stylesheet = assets.find((asset) => asset.endsWith('.css'))!;
    expect(await read(stylesheet)).toContain('.mx-auto');

    // The admin UI is a separate app; nothing about it ships with the public site.
    expect(await exists('admin.html')).toBe(false);
    expect(assets.some((asset) => asset.includes('admin'))).toBe(false);
  });

  it('ships the brand assets the pages reference', async () => {
    await buildAll();

    for (const asset of [
      'favicon.png',
      'brand/wuzzy-logo.png',
      'brand/wuzzy-mark.png',
      'brand/wuzzy-og.png',
      'fonts/BerkeleyMono-Regular.woff2',
      'fonts/BerkeleyMono-Bold.woff2',
    ]) {
      expect(await exists(asset)).toBe(true);
    }

    // The stylesheet is fingerprinted but the fonts it names are not, so a
    // renamed font file would fail silently in the browser rather than here.
    const index = await read('index.html');
    const stylesheet = /href="(\/styles\.[0-9a-f]{8}\.css)"/.exec(index)![1]!;
    const css = await read(stylesheet);
    for (const [, , url] of css.matchAll(/url\((["']?)(\/[^"')]+)\1\)/g)) {
      expect(await exists(url!)).toBe(true);
    }
  });

  it('gives an unchanged asset the same name, so caches still hit', async () => {
    const nameOf = async () => {
      await buildAll();
      const index = await read('index.html');
      return /href="(\/styles\.[0-9a-f]{8}\.css)"/.exec(index)?.[1];
    };

    // Content addressing is only worth having if it is stable: a rebuild that
    // changed nothing must not invalidate every visitor's cache.
    expect(await nameOf()).toBe((await nameOf())!);
  });

  it('keeps the body size off the root, so rem means what the design meant', async () => {
    await buildAll();
    const stylesheet = /href="(\/styles\.[0-9a-f]{8}\.css)"/.exec(await read('index.html'))![1]!;
    const css = await read(stylesheet);

    // `rem` resolves against the root element. The design sets 15px on `body`,
    // so the root stays at the browser's 16px and 53rem is 848px. Setting it
    // on `html` instead rescales every rem in the build at once, including
    // Tailwind's spacing unit, which is `.25rem`: a silent 6% shrink of the
    // whole layout that looks like nothing more than a font-size.
    const html = /(?:^|\})html\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(html).not.toContain('font-size');

    const body = /(?:^|\})body\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(body).toContain('font-size:var(--text-lead)');
  });

  it('serves the immutable header only to fingerprinted files', async () => {
    const nginx = await readFile(join(appDir, 'nginx.conf'), 'utf8');

    // Brand assets and fonts keep their names across builds, so a year-long
    // immutable cache on them would outlive any correction.
    const immutable = /location ~\* "([^"]+)"\s*\{\s*add_header Cache-Control "public, max-age=31536000, immutable"/
      .exec(nginx)?.[1];
    expect(immutable).toBeDefined();
    expect(new RegExp(immutable!, 'i').test('/styles.386ce8eb.css')).toBe(true);
    expect(new RegExp(immutable!, 'i').test('/brand/wuzzy-logo.png')).toBe(false);
    expect(new RegExp(immutable!, 'i').test('/fonts/BerkeleyMono-Regular.woff2')).toBe(false);
  });

  it('copies everything the page build reads into the image', async () => {
    // The homepage imports a captured 402 from outside its own app directory,
    // which a local build resolves and an image build does not. Both stages
    // need it: one bakes the HTML into nginx, the other renders it at
    // container start for the Cloudflare deploy, and a miss in either is a
    // build that only fails once it is somewhere that matters.
    const dockerfile = await readFile(join(appDir, 'Dockerfile'), 'utf8');
    const examples = await readFile(join(appDir, 'src', 'examples.ts'), 'utf8');

    const imported = /from '(\.\.\/)+([\w-]+\/[\w-]+)\//.exec(examples)?.[2];
    expect(imported).toBe('fixtures/examples');

    const stages = dockerfile.split(/^FROM /m).filter((stage) => stage.includes('build.ts'));
    expect(stages.length).toBe(2);
    for (const stage of stages) {
      expect(stage).toContain(`COPY ${imported}`);
    }
  });

  it('cannot reach the admin API, in dev or in production', async () => {
    const nginx = await readFile(join(appDir, 'nginx.conf'), 'utf8');
    // nginx refuses the path outright rather than proxying it.
    expect(nginx).toMatch(/location \/api\/admin\/\s*\{\s*return 404;/);

    // The dev server refuses it too, so the two do not disagree.
    const build = await readFile(join(appDir, 'build.ts'), 'utf8');
    expect(build).toContain("blockedApiPrefixes: ['/admin']");
  });
});

describe('homepage', () => {
  it('quotes the configured price rather than a number typed into copy', async () => {
    await buildAll();
    const index = await read('index.html');

    // Every worked example is the rate multiplied out, so the page cannot
    // quote an amount the meter would refuse to honour.
    for (const ticket of COMMISSION_TICKETS) {
      expect(index).toContain(priceForPages(site.pricePerPage, ticket.pages));
    }
  });

  it('moves every quoted price when the rate moves', async () => {
    // The real guarantee is not that the numbers are right today but that they
    // are derived: doubling the rate has to double the page, or something is
    // hardcoded and will go stale silently.
    const built = Bun.spawn([process.execPath, 'build.ts'], {
      cwd: appDir,
      env: { ...process.env, WUZZY_INDEX_PRICE_PER_PAGE: '$0.05' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await built.exited).toBe(0);
    const doubled = await read('index.html');

    for (const ticket of COMMISSION_TICKETS) {
      expect(doubled).toContain(priceForPages('$0.05', ticket.pages));
      expect(doubled).not.toContain(`${priceForPages(site.pricePerPage, ticket.pages)}<`);
    }
  });

  it('prints a captured 402 rather than a composed one', async () => {
    const index = await read('index.html');

    // The transcript is evidence that the meter is real, and evidence typed
    // into a template is not evidence. The amount, the status line and the
    // field names all have to come from the capture on disk.
    const accepted = capture.body.accepts[0]!;
    expect(index).toContain(accepted.maxAmountRequired);
    expect(index).toContain(`${capture.status} ${capture.statusText}`);
    expect(index).toContain('&quot;x402Version&quot;');

    // 392 pages at the configured rate is what the server actually quoted, so
    // the two have to agree or the capture is stale.
    const pages = (capture.request.body as { urls: string[] }).urls.length;
    expect(priceForPages(site.pricePerPage, pages)).toBe(
      `$${(Number(accepted.maxAmountRequired) / 1_000_000).toFixed(2)}`,
    );
  });

  it('names the provenance fields the API actually returns', async () => {
    // The receipt line under each result is the only place the page reads the
    // contract, so a renamed field here is a result that silently loses its
    // proof rather than an error anyone would notice.
    const source = await Bun.file(`${appDir}/public/search.js`).text();
    for (const field of ['provenance', 'contentHash', 'attestationUid', 'attestationUrl', 'fetchedAt']) {
      expect(source).toContain(field);
    }
  });

  it('takes every external link from site.config', async () => {
    const index = await read('index.html');

    for (const receipt of receipts.filter((entry) => entry.href)) {
      expect(index).toContain(receipt.note);
      expect(index).toContain(receipt.href!);
    }

    // A receipt with nowhere to point is absent rather than rendered as a
    // promise: this row is the page's evidence, and an entry a reviewer cannot
    // click costs more than the missing item was worth. Setting its URL in the
    // configuration brings it back with no markup change.
    for (const pending of receipts.filter((entry) => !entry.href)) {
      expect(index).not.toContain(pending.note);
    }
    expect(index).not.toContain('published at cutover');

    expect(index).toContain(site.repo);
    expect(index).toContain(site.apiOrigin);
  });

  it('links the legal pages from the footer of every page', async () => {
    for (const page of ['index.html', 'privacy.html', 'terms.html']) {
      const html = await read(page);
      expect(html).toContain('href="/privacy"');
      expect(html).toContain('href="/terms"');
      expect(html).toContain(`href="mailto:${site.contactEmail}"`);
    }
  });

  it('takes the shipping badge down by configuration, not by memory', async () => {
    // The badge is a promise with a date on it. It comes off the day the
    // creation flow is reachable in production, and the way to take it off is
    // to say so, not to delete the markup and hope nobody re-adds it.
    expect(site.indexCreationLive).toBe(false);
    expect(await read('index.html')).toContain('SHIPPING THIS WEEK');

    const shipped = Bun.spawn([process.execPath, 'build.ts'], {
      cwd: appDir,
      env: { ...process.env, INDEX_CREATION_LIVE: 'true' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await shipped.exited).toBe(0);

    const live = await read('index.html');
    expect(live).not.toContain('SHIPPING THIS WEEK');
    // Only the badge goes. The section it sat on is the product.
    expect(live).toContain('Commission your own index.');
  });

  it('serves Berkeley Mono from this origin and hotlinks no font', async () => {
    // The licence is for self-hosting. A remote stylesheet would also make the
    // page's first paint depend on a third party that can see every visitor.
    const stylesheet = /href="(\/styles\.[0-9a-f]{8}\.css)"/.exec(await read('index.html'))![1]!;
    const css = await read(stylesheet);

    expect(css).toContain('Berkeley Mono');
    for (const face of ['Regular', 'Bold', 'Italic', 'BoldItalic']) {
      expect(await exists(`/fonts/BerkeleyMono-${face}.woff2`)).toBe(true);
      expect(css).toContain(`/fonts/BerkeleyMono-${face}.woff2`);
    }

    for (const page of ['index.html', 'privacy.html', 'terms.html']) {
      const html = await read(page);
      expect(html).not.toContain('fonts.googleapis.com');
      expect(html).not.toContain('fonts.gstatic.com');
    }
    // No remote stylesheet and no remote font file. Tailwind's own banner
    // comment names its homepage, so the check is on what the CSS *loads*
    // rather than on every occurrence of the scheme.
    expect(css).not.toMatch(/url\(\s*['"]?https?:/i);
    expect(css).not.toMatch(/@import\s+(?:url\()?['"]?https?:/i);
  });

  it('types no character Berkeley Mono cannot draw', async () => {
    // A glyph the font lacks does not fail: the browser silently draws it from
    // whatever else the visitor has, so the page renders differently on every
    // platform and nobody notices until someone looks closely. This is how the
    // check mark got shipped, and it is why the mark is drawn now.
    const { inflateSync } = await import('node:zlib');

    const coverage = (file: string): Set<number> => {
      const d = require('node:fs').readFileSync(file) as Buffer;
      const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
      const tables: Record<string, Buffer> = {};
      let off = 44;
      for (let i = 0; i < view.getUint16(12); i += 1, off += 20) {
        const tag = d.subarray(off, off + 4).toString();
        const o = view.getUint32(off + 4);
        const comp = view.getUint32(off + 8);
        const orig = view.getUint32(off + 12);
        const raw = d.subarray(o, o + comp);
        tables[tag] = comp !== orig ? inflateSync(raw) : raw;
      }
      const cmap = tables.cmap!;
      const c = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength);
      const chars = new Set<number>();
      for (let i = 0; i < c.getUint16(2); i += 1) {
        const o = c.getUint32(4 + i * 8 + 4);
        if (c.getUint16(o) !== 4) continue;
        const segX2 = c.getUint16(o + 6);
        for (let seg = 0; seg < segX2 / 2; seg += 1) {
          const end = c.getUint16(o + 14 + seg * 2);
          const start = c.getUint16(o + 16 + segX2 + seg * 2);
          if (end === 0xffff) continue;
          for (let cp = start; cp <= end; cp += 1) chars.add(cp);
        }
      }
      return chars;
    };

    const faces = ['Regular', 'Bold', 'Italic', 'BoldItalic'].map((face) =>
      coverage(join(appDir, 'public', 'fonts', `BerkeleyMono-${face}.woff`)),
    );

    const built = Bun.spawn([process.execPath, 'build.ts'], {
      cwd: appDir,
      env: { ...process.env, SEARCH_ENABLED: 'true' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await built.exited).toBe(0);

    const sources = ['index.html', 'about.html', 'roadmap.html', 'privacy.html', 'terms.html'];
    const missing = new Map<number, string>();
    for (const page of sources) {
      const text = textOf((await read(page)).replace(/<(script|style)[\s\S]*?<\/\1>/g, ''));
      for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (cp > 127 && !faces.every((f) => f.has(cp))) missing.set(cp, page);
      }
    }
    // Reported as codepoints: the characters themselves are, by definition,
    // ones the reader's font may not be able to show either.
    const report = [...missing].map(([cp, page]) => `U+${cp.toString(16).toUpperCase()} in ${page}`);
    expect(report).toEqual([]);
  });

  it('ships no unused vendor script', async () => {
    // htmx was loaded on every page and used by none of them.
    expect(await exists('htmx.min.js')).toBe(false);
    expect(await read('index.html')).not.toContain('htmx');
  });
});

describe('about page', () => {
  it('renders the approved copy verbatim', async () => {
    await buildAll();
    const flat = textOf(await read('about.html'));

    // The copy was approved as written. Paraphrase is the failure mode this
    // catches: a reflow or a "small" edit that changes what the page claims.
    for (const line of [
      'About Wuzzy',
      "Agents are becoming the web's biggest readers, and the retrieval they depend on is unverifiable",
      'Wuzzy is provable, decentralized search — retrieval infrastructure where every result carries an onchain receipt',
      'You commission an index over sources you choose and pay per page in USDC — one x402 payment, no account, no API key.',
      'The public Base-ecosystem index on our homepage is simply index #1.',
      'The first Wuzzy ran on AO: crawler bots living onchain, waking on cron ticks to fetch, parse, and index autonomously.',
      "The payment rail matured — agents now pay for search across the industry — but the receipts didn't.",
      'Receipts, not trust.',
      'An honest crawler.',
      'No accounts.',
      'Hashes onchain, never content.',
      'We attest commitments, not copies.',
      "The web's memory shouldn't depend on any single library staying standing.",
      "We're building an index that can't quietly burn.",
    ]) {
      expect(flat).toContain(line);
    }
  });

  it('carries no date, so nothing on it can go stale', async () => {
    const flat = textOf(await read('about.html'));
    // The v0 story is dated in words ("well before the current build"), which
    // stays true without maintenance. A year or a month here would not.
    expect(flat).not.toMatch(/\b(?:19|20)\d{2}\b/);
    expect(flat).not.toMatch(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/,
    );
  });

  it('drops the podcast sentence rather than linking to nothing', async () => {
    // Unset by default, and the claim goes with it: a reader who cannot go and
    // hear the recording is being asked to take the story on trust, which is
    // the one thing this page argues against.
    expect(site.podcastUrl).toBeNull();
    const without = textOf(await read('about.html'));
    expect(without).not.toContain('Forward Research');
    expect(without).toContain(
      'index autonomously. Then the demand side arrived on its own',
    );

    const built = Bun.spawn([process.execPath, 'build.ts'], {
      cwd: appDir,
      env: { ...process.env, PODCAST_URL: 'https://example.com/ep' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await built.exited).toBe(0);

    const withUrl = await read('about.html');
    expect(textOf(withUrl)).toContain(
      "We described this vision publicly on Forward Research's podcast well before the current build.",
    );
    expect(withUrl).toContain('href="https://example.com/ep"');

    // The date is recorded in config and deliberately never rendered.
    expect(textOf(withUrl)).not.toMatch(/\b(?:19|20)\d{2}\b/);
  });

  it('takes every link from site.config and invents no one', async () => {
    await buildAll();
    const about = await read('about.html');

    expect(about).toContain(`${site.repo}/blob/master/VERIFY.md`);
    expect(about).toContain(site.operator.href);
    expect(about).toContain(`mailto:${site.contactEmail}`);

    // Naming people is a decision about who speaks for the project. The
    // section stops at the guild until someone makes it.
    //
    // Scoped with no fallback: an `?? about` here would let a regex that
    // stopped matching pass silently by checking the wrong thing.
    const who = /WHO BUILDS IT[\s\S]*?<\/section>/.exec(about)?.[0];
    expect(who).toBeDefined();
    expect(who).not.toMatch(/\b(?:CEO|CTO|Founder|Co-founder|Lead Engineer)\b/i);
    expect(who).toContain('a senior engineering guild');
  });

  it('keeps every line inside the measure', async () => {
    const about = await read('about.html');
    // Berkeley Mono runs long. The measure is what makes a paragraph readable
    // here, not the font size, so every prose block has to carry one.
    const prose = [...about.matchAll(/<(?:p|dd)\s+class="([^"]*)"/g)].map((m) => m[1]!);
    expect(prose.length).toBeGreaterThan(0);
    for (const classes of prose) {
      expect(classes).toMatch(/max-w-\[\d+ch\]/);
    }
  });

  it('is reachable from the bar on every page', async () => {
    for (const page of ['index.html', 'about.html', 'privacy.html', 'terms.html']) {
      const header = /<header[\s\S]*?<\/header>/.exec(await read(page))?.[0] ?? '';
      expect(header).toContain('href="/about"');
    }
  });
});

describe('roadmap page', () => {
  it('renders the approved copy verbatim', async () => {
    await buildAll();
    const flat = textOf(await read('roadmap.html'));

    for (const line of [
      "What's live, what's next",
      'Live now',
      'In build',
      'Next: deeper receipts',
      'Demonstrated in v0',
      'Every phase makes the receipts harder to argue with.',
      'Honest crawling — WuzzyBot, robots respected, posted prices honored.',
      'Open source — the whole pipeline, contracts-first.',
      'Commissioned indexes — pay to index sources you choose; public or private, one-shot or growing.',
      'Free public search window — rate-limited human access to index #1.',
      'Crawl discovery — commissioned crawls that follow a site instead of only the URLs named, inside the budget that was paid for.',
      'Verified parsing on HyperBEAM — the canonicalization step run as verifiable compute, so the hash behind a receipt can be recomputed by anyone rather than taken on our word.',
      'Permanent indexes — indexes are ephemeral today; permanent ones keep their pages on Arweave, so a receipt stays openable after the crawl that made it is gone.',
      'Multi-vantage crawling — the same page fetched over independent network paths and cross-checked, making cloaking detectable and origin claims quorum-backed.',
      'Permanent evidence — fetched content archived to permanent storage so every commitment stays openable in disputes, forever.',
      'Index maturation — owner-set pricing, richer access policies, indexes that serve their own catalogs.',
      'The autonomous version of this system already ran: crawler processes living onchain',
      'Wuzzy v1 is its rebuild on production-grade rails.',
    ]) {
      expect(flat).toContain(line);
    }
  });

  it('states a sequence, never a schedule', async () => {
    const flat = textOf(await read('roadmap.html'));

    expect(flat).not.toMatch(/\b(?:19|20)\d{2}\b/);
    expect(flat).not.toMatch(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/,
    );
    // An order cannot slip. A date can, and a roadmap that slips is the thing
    // this page exists to not be.
    expect(flat).not.toMatch(
      /\b(?:soon|shortly|imminent|upcoming|eta|Q[1-4]|days?|weeks?|months?|quarters?|years?)\b/i,
    );
  });

  it('derives live from the receipt, so shipping is a config edit', async () => {
    // Nothing on this page stores a status. An item is live exactly when the
    // proof resolves, so the page cannot claim what the site cannot show.
    const before = await read('roadmap.html');
    const liveBefore = sectionItems(before, 'LIVE NOW');
    const buildingBefore = sectionItems(before, 'IN BUILD');

    expect(liveBefore).toEqual(['Honest crawling', 'Open source']);
    expect(buildingBefore).toContain('Attested fetches');
    expect(buildingBefore).toContain('Metered search');

    const shipped = Bun.spawn([process.execPath, 'build.ts'], {
      cwd: appDir,
      env: {
        ...process.env,
        EAS_SCHEMA_URL: 'https://base.easscan.org/schema/view/0xabc',
        SETTLED_QUERY_URL: 'https://basescan.org/tx/0xdef',
        SETTLED_COMMISSION_URL: 'https://basescan.org/tx/0x123',
        SEARCH_ENABLED: 'true',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await shipped.exited).toBe(0);

    // Two URLs, no copy touched, and both claims moved section.
    const after = await read('roadmap.html');
    expect(sectionItems(after, 'LIVE NOW')).toEqual([
      'Honest crawling',
      'Attested fetches',
      'Metered search',
      'Commissioned indexes',
      'Free public search window',
      'Open source',
    ]);
    // What is left is work that has never claimed a receipt.
    expect(sectionItems(after, 'IN BUILD')).toEqual([
      'Crawl discovery',
      'Verified parsing on HyperBEAM',
      'Permanent indexes',
    ]);
    expect(after).toContain('https://base.easscan.org/schema/view/0xabc');
  });

  it('numbers only the sections it rendered, and renders none empty', async () => {
    await buildAll();
    const roadmap = await read('roadmap.html');

    const markers = [...roadmap.matchAll(/tracking-marker[^>]*>(\d\d) \u2014 ([^<]+)</g)];
    expect(markers.length).toBeGreaterThan(0);
    // Contiguous from 01: a collapsed section must not leave a hole in the count.
    expect(markers.map((m) => m[1]!)).toEqual(
      markers.map((_, i) => String(i + 1).padStart(2, '0')),
    );

    // No section renders as a heading over nothing. Not every section is a
    // list — the v0 one is prose — so the check is that something followed the
    // heading, not that a particular shape did.
    for (const section of roadmap.match(/<section[\s\S]*?<\/section>/g) ?? []) {
      const afterHeading = section.slice(section.indexOf('</h2>') + 5);
      expect(textOf(afterHeading).length).toBeGreaterThan(0);
    }
  });

  it('wears the receipt line the homepage results wear', async () => {
    const roadmap = await read('roadmap.html');
    const search = await Bun.file(`${appDir}/public/search.js`).text();

    // A status here and a result there are the same kind of assertion, so they
    // must not look like different kinds.
    for (const shared of ['text-receipt', 'text-ink-muted', 'gap-x-[14px]']) {
      expect(roadmap).toContain(shared);
      expect(search).toContain(shared);
    }
    expect(roadmap).toContain(`${site.repo}/blob/master/VERIFY.md`);
  });

  it('draws the same mark the ledger draws, from one definition', async () => {
    // The mark is drawn rather than typed, so there are two chances to draw it
    // differently. There is instead one definition: the homepage renders it
    // into a template and the script reads that, so the only way they can
    // disagree is if the script stops reading it.
    const search = await Bun.file(`${appDir}/public/search.js`).text();
    expect(search).toContain("getElementById('attested-mark')");
    expect(search).toContain('template.innerHTML');
    // No second copy of the drawing anywhere in the script.
    expect(search).not.toContain('<svg');

    // The template lives inside the case, so it only exists when the box does.
    // That is correct: nothing reads it otherwise, because the script that
    // does is loaded by the same component.
    const built = Bun.spawn([process.execPath, 'build.ts'], {
      cwd: appDir,
      env: { ...process.env, SEARCH_ENABLED: 'true' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await built.exited).toBe(0);

    const template = /<template id="attested-mark">([\s\S]*?)<\/template>/.exec(
      await read('index.html'),
    )?.[1];
    expect(template).toBeDefined();

    // Same drawing on both pages, down to the path.
    const path = /<path d="([^"]+)"/.exec(template!)?.[1];
    expect(path).toBeDefined();
    expect(await read('roadmap.html')).toContain(`<path d="${path}"`);
  });

  it('is reachable from the bar on every page', async () => {
    for (const page of ['index.html', 'about.html', 'roadmap.html', 'privacy.html', 'terms.html']) {
      const header = /<header[\s\S]*?<\/header>/.exec(await read(page))?.[0] ?? '';
      expect(header).toContain('href="/roadmap"');
    }
  });
});

describe('legal pages', () => {
  it('describe no practice from the deprecated architecture', async () => {
    await buildAll();

    // The pages were carried over from a site that resolved ArNS names and
    // queried Goldsky over GraphQL. None of that exists here, so a mention of
    // it is a claim about a service that is not running.
    const forbidden = /arns|goldsky|graphql|arweave|opensearch|permaweb/i;
    for (const page of ['privacy.html', 'terms.html']) {
      const html = await read(page);
      const found = html.match(forbidden);
      expect(found?.[0] ?? null).toBeNull();
    }
  });

  it('receive notice at their own addresses, not the site\'s front door', async () => {
    // The policy and the terms name the addresses they undertake to receive
    // notice at. Those are commitments in the documents, so they must not
    // follow `contactEmail` when the site's general way in changes.
    expect(site.legalEmail).not.toBe(site.contactEmail);
    expect(site.dmcaEmail).not.toBe(site.contactEmail);

    for (const [page, expected] of [
      ['privacy.html', [site.legalEmail]],
      ['terms.html', [site.legalEmail, site.dmcaEmail]],
    ] as const) {
      const html = await read(page);
      const footer = /<footer[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';
      const body = html.replace(footer, '');

      const inBody = [...new Set([...body.matchAll(/mailto:([^"]+)/g)].map((m) => m[1]!))];
      expect(inBody.sort()).toEqual([...expected].sort());

      // The footer is site chrome and carries the general address everywhere,
      // legal pages included. That is the one place the two may differ.
      expect(footer).toContain(`mailto:${site.contactEmail}`);
    }
  });

  it('date both documents from one place', async () => {
    // The two are revised together. Two literals in two files is how one of
    // them ends up a year stale, on a page whose whole job is to be current.
    for (const page of ['privacy.html', 'terms.html']) {
      const html = await read(page);
      expect(html).toContain(`<strong>Effective Date:</strong> ${site.legalEffective}`);
      expect(html).toContain(`<strong>Last Updated:</strong> ${site.legalUpdated}`);
    }

    // The policy promises to bump "Last Updated" when the text changes, so a
    // revision that predates the agreement itself would be a broken promise.
    expect(Date.parse(site.legalUpdated)).toBeGreaterThanOrEqual(Date.parse(site.legalEffective));
  });

  it('keep the clauses that were never architecture-specific', async () => {
    const terms = await read('terms.html');
    // Removal ran deep enough to be worth pinning: these are the protective
    // clauses, and losing one to an over-eager edit should fail the build.
    expect(terms).toContain('Limitation of Liability');
    expect(terms).toContain('Indemnification');
    expect(terms).toContain('DMCA');
    expect(terms).toContain('State of Wyoming');
  });
});

describe('free search box', () => {
  it('renders nothing at all while the flag is off', async () => {
    await buildAll();
    const index = await read('index.html');

    expect(site.searchEnabled).toBe(false);
    expect(index).not.toContain('id="search-form"');
    expect(index).not.toContain('search.js');
    // The page has to stand up without it: the product and the proof are the
    // argument, and the box only ever demonstrated them.
    expect(index).toContain('Commission your own index.');
    expect(index).toContain('How a result proves itself.');
    expect(index).toContain('SESSION TRANSCRIPT');

    // The call to action belongs to the act, not to the box. With the box off
    // the hero would otherwise have nowhere to go from it.
    expect(index).toContain('href="#commission"');
  });

  it('posts to the free route, never the metered one, when the flag is on', async () => {
    const built = Bun.spawn([process.execPath, 'build.ts'], {
      cwd: appDir,
      env: { ...process.env, SEARCH_ENABLED: 'true' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await built.exited).toBe(0);

    const index = await read('index.html');
    expect(index).toContain('id="search-form"');
    expect(index).toMatch(/src="\/search\.[0-9a-f]{8}\.js"/);

    const script = /src="(\/search\.[0-9a-f]{8}\.js)"/.exec(index)![1]!;
    const source = await read(script);
    // The paid contract's scenarios are what /search is for. The box is free,
    // so it must not be able to spend anyone's money by accident. The endpoint
    // is rendered onto the form rather than hardcoded, so the guarantee is
    // checked on both halves: what the page asks for, and what the script does
    // when the attribute is missing.
    expect(index).toContain('data-endpoint="/api/web-search"');
    expect(source).toContain("form.getAttribute('data-endpoint') || '/api/web-search'");
    expect(source).toContain('fetch(ENDPOINT');
    expect(source).not.toContain("'/api/search'");
  });

  it('puts the brand and the things a reviewer checks in one bar on every page', async () => {
    const built = Bun.spawn([process.execPath, 'build.ts'], {
      cwd: appDir,
      env: { ...process.env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await built.exited).toBe(0);

    // Every page, not just the home page: a reader who lands on /terms needs
    // to know whose site it is, and the source has to be one click from
    // wherever they are.
    for (const page of ['index.html', 'privacy.html', 'terms.html']) {
      const html = await read(page);
      const header = /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
      expect(header).toContain('/brand/wuzzy-logo.png');
      expect(header).toContain(site.name);
      expect(header).toContain(site.wordmarkSubtitle);
      expect(header).toContain(site.docsOrigin);
      expect(header).toContain(site.repo);
      expect(header).toContain('VERIFY.md');

      // The legal pages moved to the footer rather than off the site. The bar
      // is the most valuable row on the page and these are the two links
      // nobody arrives wanting, but a reader still has to be able to find them.
      const footer = /<footer[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';
      for (const legal of ['/privacy', '/terms']) {
        expect(header).not.toContain(`href="${legal}"`);
        expect(footer).toContain(`href="${legal}"`);
      }
    }
  });

  it('offers a sample search only when the box is on', async () => {
    const withBox = Bun.spawn([process.execPath, 'build.ts'], {
      cwd: appDir,
      env: { ...process.env, SEARCH_ENABLED: 'true' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await withBox.exited).toBe(0);

    const on = await read('index.html');
    expect(on).toContain(`data-samples="${site.sampleQueries.join('|')}"`);
    // The input stays empty, so a reader can type without clearing it first.
    expect(on).not.toContain(`value="${site.sampleQueries[0]}"`);

    const withoutBox = Bun.spawn([process.execPath, 'build.ts'], {
      cwd: appDir,
      env: { ...process.env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await withoutBox.exited).toBe(0);
    expect(await read('index.html')).not.toContain('data-samples');
  });

  it('bounds the demo so the page below it cannot move', async () => {
    const built = Bun.spawn([process.execPath, 'build.ts'], {
      cwd: appDir,
      env: { ...process.env, SEARCH_ENABLED: 'true' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await built.exited).toBe(0);
    const index = await read('index.html');

    // Fixed height, not max height. A max height still grows from two sample
    // rows to five result rows, which shoves the commissioning and proof
    // sections down the page exactly when a reader is deciding if this is real.
    expect(index).toContain('h-[34rem]');
    expect(index).not.toMatch(/max-h-\[34rem\]/);
    expect(index).toContain('overflow-y-auto');

    // No paging. Five results is the demonstration; the rest is what the
    // metered API sells, so there is nothing to page to.
    for (const gone of ['id="pager"', 'id="prev"', 'id="next"', 'id="page-of"']) {
      expect(index).not.toContain(gone);
    }

    // Only the ledger scrolls. The input and both captions are chrome: if they
    // scrolled with the results, the reader would lose the box they just used.
    expect(index).toMatch(/id="ledger"[^>]*overflow-y-auto/);
    expect(index).not.toMatch(/id="search-form"[^>]*overflow-y-auto/);

    // Exactly one promotional thing next to the search, and it points at the
    // section below rather than off the page.
    const act1 = /<section class="border-rule border-b pt-11[\s\S]*?<\/section>/.exec(index)?.[0] ?? '';
    expect(act1).toContain('Commission your own index');
    expect(act1.match(/href="#commission"/g)?.length).toBe(1);
  });

  it('caps the demo at five results and two samples', async () => {
    const source = await Bun.file(`${appDir}/public/search.js`).text();
    expect(source).toContain('var SAMPLE_COUNT = 2');
    expect(source).toContain('var RESULT_COUNT = 5');
    // The wording that keeps the cap honest rather than looking like a bug.
    expect(source).toContain('agents get full results through the');
    // Both bounded states are spelled out rather than falling through to a
    // generic error a reader would read as breakage.
    expect(source).toContain('The free window is rate-limited for humans');
    expect(source).toContain('No results in index #1 for that');
    // Every caption the ledger can show, so a state cannot land captionless.
    for (const caption of [
      'SAMPLE RESULTS',
      'RESULTS \u00b7 INDEX #1',
      'NO MATCHES \u00b7 INDEX #1',
      'FREE WINDOW EXHAUSTED',
      'INDEX #1 \u00b7 BEING COMMISSIONED',
    ]) {
      expect(source).toContain(caption);
    }
  });

  it('makes a search linkable without filling the back button', async () => {
    const source = await Bun.file(`${appDir}/public/search.js`).text();

    // replaceState, never pushState: the box is one control on a page, and
    // filling the reader's history with their own typing would make leaving
    // take as many presses as they made searches.
    expect(source).toContain('history.replaceState');
    expect(source).not.toContain('history.pushState');
    expect(source).toContain("searchParams.set('q'");
    expect(source).toContain("searchParams.get('q')");

    // An arriving ?q= is a question that was asked; samples answer one nobody
    // asked, so the linked query has to win.
    expect(source).toMatch(/if \(linked[\s\S]*?run\(linked[\s\S]*?\} else \{\s*sample\(true\);/);
  });

  it('cannot resize or zoom itself out from under a reader on a phone', async () => {
    const built = Bun.spawn([process.execPath, 'build.ts'], {
      cwd: appDir,
      env: { ...process.env, SEARCH_ENABLED: 'true' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await built.exited).toBe(0);
    const index = await read('index.html');

    // `vh` is measured with the mobile toolbars hidden, so a vh-capped case
    // grows as the reader scrolls and drags the whole page with it. `svh` is
    // measured with them shown and holds still. The vh line stays as the
    // fallback, so the pair has to survive together.
    expect(index).toContain('max-height:80vh;max-height:80svh');

    // Mobile Safari zooms the viewport when a focused field is under 16px.
    // The design's 14px applies from `sm` up, where there is no such zoom.
    expect(index).toMatch(/id="query"[\s\S]*?text-\[16px\] sm:text-item/);
  });

  it('refreshes the sample without racing itself', async () => {
    // The only interactive control on the site, and the only one that can be
    // pressed repeatedly without typing. Exercised against a stub DOM rather
    // than grepped for, because every property that matters here is behaviour.
    const source = await Bun.file(`${appDir}/public/search.js`).text();

    const el = (attrs: Record<string, string> = {}) => ({
      attrs,
      value: '',
      textContent: '',
      innerHTML: '',
      hidden: true,
      disabled: false,
      scrollTop: 0,
      handlers: {} as Record<string, ((e: unknown) => void)[]>,
      getAttribute(name: string) {
        return this.attrs[name] ?? null;
      },
      addEventListener(name: string, fn: (e: unknown) => void) {
        (this.handlers[name] ||= []).push(fn);
      },
      click() {
        for (const fn of this.handlers.click ?? []) fn({ preventDefault() {} });
      },
    });

    const samples = ['alpha', 'beta', 'gamma', 'delta'];
    const nodes: Record<string, ReturnType<typeof el>> = {
      'search-form': el({ 'data-endpoint': '/x', 'data-samples': samples.join('|') }),
      query: el(),
      'ledger-caption': el(),
      ledger: el(),
      'ledger-refresh': el(),
    };

    const asked: string[] = [];
    let hold = false;
    let release: (() => void) | null = null;

    const location = { href: 'https://wuzzy.io/?q=deeplinked' };
    const context = {
      document: { getElementById: (id: string) => nodes[id] ?? null },
      window: {
        location,
        history: {
          replaceState: (_s: unknown, _t: string, url: string) => {
            location.href = url;
          },
        },
      },
      URL,
      fetch: (_url: string, init: { body: string }) => {
        asked.push(JSON.parse(init.body).query);
        const response = {
          status: 200,
          json: () => Promise.resolve({ results: [], total: 0 }),
        };
        return hold ? new Promise((r) => (release = () => r(response))) : Promise.resolve(response);
      },
    };

    new Function(...Object.keys(context), source)(...Object.values(context));
    await Bun.sleep(10);

    // A linked query is a question that was asked. Samples answer one nobody did.
    expect(asked[0]).toBe('deeplinked');
    const refresh = nodes['ledger-refresh']!;
    expect(refresh.hidden).toBe(false);

    refresh.click();
    await Bun.sleep(10);
    expect(samples).toContain(asked[1]!);
    // The address bar described a search that is no longer on screen.
    expect(location.href).not.toContain('q=');
    expect(nodes.query!.value).toBe('');

    // Getting the same two rows back reads as a broken button, not a coincidence.
    for (let i = 0; i < 30; i += 1) {
      const before = asked[asked.length - 1];
      refresh.click();
      await Bun.sleep(2);
      expect(asked[asked.length - 1]).not.toBe(before);
    }

    // One request at a time, or results land in the ledger out of order.
    hold = true;
    const sent = asked.length;
    refresh.click();
    await Bun.sleep(5);
    expect(refresh.disabled).toBe(true);
    refresh.click();
    refresh.click();
    await Bun.sleep(5);
    expect(asked.length).toBe(sent + 1);

    release!();
    await Bun.sleep(10);
    expect(refresh.disabled).toBe(false);
  });

  it('says when the free window ran out, however the request was made', async () => {
    // The free window is ten queries a minute, and the refresh button makes it
    // reachable in ten clicks. Rendering an empty case in that situation tells
    // the reader nothing and reads as a dead product.
    const source = await Bun.file(`${appDir}/public/search.js`).text();

    const el = (attrs: Record<string, string> = {}) => ({
      attrs,
      value: '',
      textContent: '',
      innerHTML: '',
      hidden: true,
      disabled: false,
      scrollTop: 0,
      handlers: {} as Record<string, ((e: unknown) => void)[]>,
      getAttribute(name: string) {
        return this.attrs[name] ?? null;
      },
      addEventListener(name: string, fn: (e: unknown) => void) {
        (this.handlers[name] ||= []).push(fn);
      },
    });

    const attempt = async (
      status: number,
      act: 'load' | 'click' | 'submit',
      results: unknown[] = [],
    ) => {
      const nodes: Record<string, ReturnType<typeof el>> = {
        'search-form': el({ 'data-endpoint': '/x', 'data-samples': 'a|b|c|d' }),
        query: el(),
        'ledger-caption': el(),
        ledger: el(),
        'ledger-refresh': el(),
        'ledger-live': el(),
      };
      let code = act === 'load' ? status : 200;
      const location = { href: 'https://wuzzy.io/' };
      const context = {
        document: { getElementById: (id: string) => nodes[id] ?? null },
        window: {
          location,
          history: { replaceState: (_s: unknown, _t: string, u: string) => (location.href = u) },
        },
        URL,
        fetch: () =>
          Promise.resolve({
            status: code,
            json: () =>
              Promise.resolve({
                results,
                total: results.length,
                error: 'rate limit exceeded',
              }),
          }),
      };
      new Function(...Object.keys(context), source)(...Object.values(context));
      await Bun.sleep(8);

      code = status;
      if (act === 'click') for (const fn of nodes['ledger-refresh']!.handlers.click ?? []) fn({});
      if (act === 'submit') {
        nodes.query!.value = 'typed';
        for (const fn of nodes['search-form']!.handlers.submit ?? []) fn({ preventDefault() {} });
      }
      await Bun.sleep(12);
      return {
        caption: nodes['ledger-caption']!.textContent,
        ledger: nodes.ledger!.innerHTML,
        badgeHidden: nodes['ledger-live']!.hidden,
      };
    };

    // Every route to a rate limit says so, the opening sample included: it is a
    // documented state of the free window with copy written for it, not a
    // breakage to be hidden.
    for (const act of ['click', 'submit', 'load'] as const) {
      const out = await attempt(429, act);
      expect(out.caption).toBe('FREE WINDOW EXHAUSTED');
      expect(out.ledger).toContain('The free window is rate-limited for humans');
    }

    // A sample nobody asked for still must not open by blaming the reader for
    // our own outage. That silence is deliberate and stays.
    const broken = await attempt(500, 'load');
    expect(broken.caption).toContain('SAMPLE RESULTS');
    // But it may not call itself LIVE over an empty box either.
    expect(broken.badgeHidden).toBe(true);

    // An index with nothing in it yet is not a search that found nothing. It
    // says what is actually happening, and the case does not claim to be LIVE
    // until there is a result in it to look at.
    const unpopulated = await attempt(200, 'load');
    expect(unpopulated.caption).toBe('INDEX #1 \u00b7 BEING COMMISSIONED');
    expect(unpopulated.ledger).toContain('being commissioned');
    expect(unpopulated.badgeHidden).toBe(true);

    // And it does claim LIVE the moment there is a real entry, from the same
    // condition rather than a flag that could be left set over an empty case.
    const populated = await attempt(200, 'load', [
      { url: 'https://docs.base.org/', title: 'Base', snippet: 'x', provenance: {} },
    ]);
    expect(populated.badgeHidden).toBe(false);
    expect(broken.ledger).toBe('');
  });

  it('sends the box at another origin when the site is served statically', async () => {
    // A Cloudflare Pages build has no nginx to proxy /api, so the endpoint has
    // to be absolute. Same build, one variable.
    const built = Bun.spawn([process.execPath, 'build.ts'], {
      cwd: appDir,
      env: {
        ...process.env,
        SEARCH_ENABLED: 'true',
        WEB_SEARCH_URL: 'https://api.wuzzy.io/web-search',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await built.exited).toBe(0);

    const index = await read('index.html');
    expect(index).toContain('data-endpoint="https://api.wuzzy.io/web-search"');
    // Still the free route, wherever it is pointed.
    expect(index).not.toContain('data-endpoint="https://api.wuzzy.io/search"');
  });
});

describe('machine-readable discovery', () => {
  it('publishes a sitemap and llms.txt for the pages it actually rendered', async () => {
    await buildAll();

    const sitemap = await read('sitemap.xml');
    const llms = await read('llms.txt');
    for (const path of ['/', '/about', '/privacy', '/roadmap', '/terms']) {
      expect(sitemap).toContain(`<loc>${site.origin}${path}</loc>`);
      expect(llms).toContain(`(${site.origin}${path})`);
    }

    // Extensionless, because Cloudflare Pages resolves /about to about.html
    // and advertising the .html would publish a second URL for one page.
    expect(sitemap).not.toContain('.html');
    expect(llms).not.toContain('.html');
  });

  it('renders a 404 page and keeps it out of both', async () => {
    await buildAll();

    // Without this file Pages serves index.html with a 200 for every unknown
    // path, so a typo and a real page look identical to anything reading a
    // status code.
    expect(await exists('404.html')).toBe(true);
    expect(await read('sitemap.xml')).not.toContain('/404');
    expect(await read('llms.txt')).not.toContain('/404');
  });

  it('tells an agent what a request costs before it makes one', async () => {
    await buildAll();

    const llms = await read('llms.txt');
    expect(llms).toContain(site.apiOrigin);
    expect(llms).toContain(site.docsOrigin);
    expect(llms).toContain(site.pricePerPage);
    expect(llms).toContain('402');
  });

  it('keeps a deploy out of the index unless it says otherwise', async () => {
    await buildAll();

    // site.indexable is false without SITE_INDEXABLE, and the suite does not
    // set it, so this is the stage and preview default: a robots.txt that
    // stops a non-production deploy competing with production for its own
    // results.
    expect(site.indexable).toBe(false);
    expect(await read('robots.txt')).toContain('Disallow: /');
  });
});
