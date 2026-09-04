// Pre-renders src/pages/**/*.tsx to static HTML in dist/ and copies public/.
//
//   bun build.ts                 one-shot build
//   bun build.ts --watch --serve rebuild on change + dev server on :8080
//                                (proxies /api/* to BACKEND_URL, default :3000)

import { Glob } from 'bun';
import { watch } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = import.meta.dir;
const pagesDir = join(root, 'src', 'pages');
const publicDir = join(root, 'public');
const distDir = join(root, 'dist');

export async function buildAll(): Promise<string[]> {
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

// Compiles src/styles.css with Tailwind. Run from this directory so
// Tailwind's automatic class detection scans the app sources.
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

function watchAndRebuild() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rebuild = () => {
    clearTimeout(timer);
    // Spawn a fresh process so edited modules aren't served from the import cache.
    timer = setTimeout(() => Bun.spawn([process.execPath, import.meta.path], { stdout: 'inherit', stderr: 'inherit' }), 100);
  };
  for (const dir of [join(root, 'src'), publicDir]) {
    watch(dir, { recursive: true }, rebuild);
  }
  console.log('watching src/ and public/ for changes');
}

function serve() {
  const port = Number(process.env.FRONTEND_PORT ?? 8080);
  const backend = process.env.BACKEND_URL ?? 'http://localhost:3000';
  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.startsWith('/api/')) {
        return fetch(new Request(backend + url.pathname + url.search, req));
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

if (import.meta.main) {
  const args = new Set(Bun.argv.slice(2));
  const written = await buildAll();
  console.log(`built ${written.length} page(s) to dist/`);
  if (args.has('--watch')) watchAndRebuild();
  if (args.has('--serve')) serve();
}
