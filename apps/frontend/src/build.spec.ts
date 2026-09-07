import { afterAll, describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildAll } from '../build';
import { receipts, site } from './site.config';

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

    expect(index).toContain(`One query costs ${site.queryPrice} in USDC on ${site.networkLabel}`);

    // The 402 body and the client ceiling are the same atomic amount the meter
    // would quote, so a price change cannot leave one of them stale.
    const samples = codeSamples(index);
    expect(samples).toContain(`"maxAmountRequired": "${site.queryPriceAtomic}"`);
    expect(samples).toContain(`--max-amount ${site.queryPriceAtomic}`);
  });

  it('names the provenance fields the API actually returns', async () => {
    const samples = codeSamples(await read('index.html'));

    // The quickstart is the integration doc a reviewer reads before writing a
    // client, so a renamed field here is a lie about the contract.
    for (const field of [
      'provenance',
      'contentHash',
      'attestationUid',
      'attestationUrl',
      'protocolVersion',
    ]) {
      expect(samples).toContain(`"${field}"`);
    }
    expect(samples).toContain(site.protocol);
  });

  it('takes every external link from site.config', async () => {
    const index = await read('index.html');

    for (const receipt of receipts) {
      expect(index).toContain(receipt.note);
      if (receipt.href) expect(index).toContain(receipt.href);
    }

    // A receipt that has not been published yet says so, instead of rendering
    // a link that goes nowhere.
    const pending = receipts.filter((receipt) => receipt.href === null);
    if (pending.length > 0) expect(index).toContain('published at cutover');

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

  it('ships no unused vendor script', async () => {
    // htmx was loaded on every page and used by none of them.
    expect(await exists('htmx.min.js')).toBe(false);
    expect(await read('index.html')).not.toContain('htmx');
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
    // The page has to stand up without it: the quickstart is the evidence.
    expect(index).toContain('Agent quickstart');
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
    // so it must not be able to spend anyone's money by accident.
    expect(source).toContain("fetch('/api/web-search'");
    expect(source).not.toContain("'/api/search'");
  });
});
