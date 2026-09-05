// Pre-renders an app's src/pages/**/*.tsx to static HTML and copies public/.
//
// Shared by every static app in the repo. The site-specific part is only the
// root directory and the dev proxy target, so each app's build.ts is a shim
// around this and the two cannot drift apart.

import { Glob } from 'bun';
import { watch } from 'node:fs';
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
    return written;
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
