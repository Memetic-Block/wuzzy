// Pre-renders an app's src/pages/**/*.tsx to static HTML and copies public/.
//
// Shared by every static app in the repo. The site-specific part is only the
// root directory and the dev proxy target, so each app's build.ts is a shim
// around this and the two cannot drift apart.

import { Glob } from 'bun';
import { existsSync, watch } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface SiteOptions {
  /** The app directory: the one holding src/ and public/. */
  readonly root: string;
  /** Where the dev server proxies /api/* . */
  readonly backendUrl?: string;
  readonly port?: number;
  /**
   * Paths under /api/ the dev server refuses to proxy, as prefixes. The public
   * site uses this to make sure it cannot reach the admin API even by accident;
   * nginx enforces the same rule in production.
   */
  readonly blockedApiPrefixes?: readonly string[];
  /**
   * Emit robots.txt, sitemap.xml and llms.txt for the rendered pages.
   *
   * Opt-in, and absent for the admin app on purpose: that surface is kept off
   * the public internet, and publishing a machine-readable index of it would
   * work against the one thing its separate origin exists to do.
   */
  readonly discovery?: DiscoveryOptions;
}

export interface DiscoveryOptions {
  /** Absolute origin the files advertise, with no trailing slash. */
  readonly origin: string;
  /** One or two lines under the title in llms.txt. */
  readonly description: string;
  /**
   * Whether search engines may index the site. Opt-in, so a stage or preview
   * deploy that forgets to say anything stays out of the index rather than
   * competing with production for its own results.
   */
  readonly indexable: boolean;
  /** Extra lines for llms.txt, as bullet text. */
  readonly notes?: readonly string[];
}

export interface Site {
  buildAll(): Promise<string[]>;
  watchAndRebuild(entry: string): void;
  serve(): void;
}

export function createSite(options: SiteOptions): Site {
  const { root } = options;
  const pagesDir = join(root, 'src', 'pages');
  const publicDir = join(root, 'public');
  const distDir = join(root, 'dist');

  async function buildAll(): Promise<string[]> {
    await rm(distDir, { recursive: true, force: true });
    await mkdir(distDir, { recursive: true });

    const written: string[] = [];
    for await (const file of new Glob('**/*.tsx').scan(pagesDir)) {
      const page = (await import(join(pagesDir, file))).default;
      if (typeof page !== 'function') {
        throw new Error(`src/pages/${file} has no default-exported component`);
      }
      const outFile = join(distDir, file.replace(/\.tsx$/, '.html'));
      await mkdir(dirname(outFile), { recursive: true });
      await Bun.write(outFile, `<!doctype html>\n${page()}`);
      written.push(outFile);
    }

    await cp(publicDir, distDir, { recursive: true });
    await buildStyles();
    await fingerprintAssets(written);
    if (options.discovery) await writeDiscovery(options.discovery, written);
    return written;
  }

  /**
   * The three files a machine reads before it reads any page.
   *
   * Written from the pages that actually rendered rather than from a list
   * somebody maintains, so a new page is discoverable the moment it exists and
   * a deleted one stops being advertised. A sitemap that lists a page which is
   * not there is worse than no sitemap: it is a promise the site breaks.
   */
  async function writeDiscovery(
    discovery: DiscoveryOptions,
    pages: readonly string[],
  ): Promise<void> {
    const origin = discovery.origin.replace(/\/$/, '');
    // Cloudflare Pages resolves /about to about.html, so the extensionless
    // path is the one to advertise. 404 is a page the site renders, not a
    // destination to send anybody to.
    const paths = pages
      .map((file) => file.slice(distDir.length).replace(/\\/g, '/'))
      .map((path) => path.replace(/\.html$/, ''))
      .map((path) => (path === '/index' ? '/' : path))
      .filter((path) => path !== '/404')
      .sort();

    await Bun.write(
      join(distDir, 'robots.txt'),
      discovery.indexable
        ? ['User-agent: *', 'Allow: /', '', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n')
        : ['User-agent: *', 'Disallow: /', ''].join('\n'),
    );

    const lastmod = new Date().toISOString();
    await Bun.write(
      join(distDir, 'sitemap.xml'),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...paths.map((path) =>
          [
            '  <url>',
            `    <loc>${origin}${path}</loc>`,
            `    <lastmod>${lastmod}</lastmod>`,
            `    <priority>${path === '/' ? '1.0' : '0.8'}</priority>`,
            '  </url>',
          ].join('\n'),
        ),
        '</urlset>',
        '',
      ].join('\n'),
    );

    await Bun.write(
      join(distDir, 'llms.txt'),
      [
        '# Wuzzy',
        '',
        `> ${discovery.description}`,
        '',
        '## Pages',
        '',
        ...paths.map((path) => `- [${path === '/' ? 'Home' : path}](${origin}${path})`),
        ...(discovery.notes?.length ? ['', '## Notes', '', ...discovery.notes.map((n) => `- ${n}`)] : []),
        '',
      ].join('\n'),
    );
  }

  /**
   * Content-addresses every js and css file and rewrites the pages to match.
   *
   * Assets are served with a long max-age, so a stable filename means a
   * returning browser keeps running yesterday's script for as long as its
   * cache says it may, and a shipped fix is invisible until then. The hash is
   * the cache key: changed content is a different URL, unchanged content stays
   * cached, and no deploy has to guess how long to wait.
   */
  async function fingerprintAssets(pages: readonly string[]): Promise<void> {
    const renamed = new Map<string, string>();
    for await (const file of new Glob('**/*.{js,css}').scan(distDir)) {
      const bytes = await Bun.file(join(distDir, file)).arrayBuffer();
      const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex').slice(0, 8);
      const dot = file.lastIndexOf('.');
      const hashed = `${file.slice(0, dot)}.${hash}${file.slice(dot)}`;

      await Bun.write(join(distDir, hashed), bytes);
      await rm(join(distDir, file));
      renamed.set(`/${file}`, `/${hashed}`);
    }

    for (const page of pages) {
      let html = await Bun.file(page).text();
      for (const [from, to] of renamed) html = html.replaceAll(`="${from}"`, `="${to}"`);
      await Bun.write(page, html);
      assertEveryAssetResolves(html, page);
    }
  }

  /**
   * The originals are gone once they are hashed, so a reference the rewrite
   * missed is a 404 rather than a stale file. Catching it here makes that a
   * build failure instead of a broken page.
   */
  function assertEveryAssetResolves(html: string, page: string): void {
    for (const match of html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)) {
      const referenced = match[1]!;
      if (!existsSync(join(distDir, referenced))) {
        throw new Error(`${page} references ${referenced}, which the build did not produce`);
      }
    }
  }

  // Compiles src/styles.css with Tailwind. Run from the app directory so
  // Tailwind's automatic class detection scans that app's sources only.
  async function buildStyles(): Promise<void> {
    const proc = Bun.spawn(
      [
        process.execPath, 'x', '@tailwindcss/cli',
        '-i', join(root, 'src', 'styles.css'),
        '-o', join(distDir, 'styles.css'),
        '--minify',
      ],
      { cwd: root, stdout: 'inherit', stderr: 'inherit' },
    );
    if ((await proc.exited) !== 0) throw new Error('tailwind build failed');
  }

  function watchAndRebuild(entry: string): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rebuild = () => {
      clearTimeout(timer);
      // Spawn a fresh process so edited modules aren't served from the import cache.
      timer = setTimeout(
        () => Bun.spawn([process.execPath, entry], { stdout: 'inherit', stderr: 'inherit' }),
        100,
      );
    };
    for (const dir of [join(root, 'src'), publicDir]) {
      watch(dir, { recursive: true }, rebuild);
    }
    console.log('watching src/ and public/ for changes');
  }

  function serve(): void {
    const port = options.port ?? Number(process.env.FRONTEND_PORT ?? 8080);
    const backend = options.backendUrl ?? process.env.BACKEND_URL ?? 'http://localhost:3000';
    const blocked = options.blockedApiPrefixes ?? [];

    Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.startsWith('/api/')) {
          // Strip /api so the backend keeps a clean public shape: the browser
          // calls /api/search, the API itself is /search, and the demo agent
          // and the x402 resource URL name the same path a third party would.
          const path = url.pathname.slice('/api'.length);
          if (blocked.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
            return new Response('Not Found', { status: 404 });
          }
          return fetch(new Request(backend + path + url.search, req));
        }
        const path = url.pathname === '/' ? '/index.html' : url.pathname;
        for (const candidate of [path, `${path}.html`]) {
          const file = Bun.file(join(distDir, candidate));
          if (await file.exists()) return new Response(file);
        }
        return new Response('Not Found', { status: 404 });
      },
    });
    console.log(`dev server on http://localhost:${port} (proxying /api to ${backend})`);
  }

  return { buildAll, watchAndRebuild, serve };
}

/** The shared entry point every app's build.ts calls. */
export async function runCli(options: SiteOptions, entry: string): Promise<Site> {
  const site = createSite(options);
  const args = new Set(Bun.argv.slice(2));
  const written = await site.buildAll();
  console.log(`built ${written.length} page(s) to dist/`);
  if (args.has('--watch')) site.watchAndRebuild(entry);
  if (args.has('--serve')) site.serve();
  return site;
}
