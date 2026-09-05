import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildAll } from '../build';

describe('static build', () => {
  it('pre-renders pages to dist', async () => {
    const written = await buildAll();
    expect(written.length).toBeGreaterThan(0);

    const distDir = join(import.meta.dir, '..', 'dist');
    const index = await Bun.file(join(distDir, 'index.html')).text();
    expect(index).toStartWith('<!doctype html>');
    expect(index).toContain('<title>Wuzzy</title>');
    expect(index).toContain('id="search-form"');
    expect(index).toContain('htmx.min.js');

    // The search page is inert without its client script.
    expect(await Bun.file(join(distDir, 'search.js')).exists()).toBe(true);

    expect(await Bun.file(join(distDir, 'htmx.min.js')).exists()).toBe(true);

    // Tailwind compiled and picked up classes used in the pages.
    const styles = await Bun.file(join(distDir, 'styles.css')).text();
    expect(styles).toContain('.mx-auto');

    // The admin UI is a separate app; nothing about it ships with the public site.
    expect(await Bun.file(join(distDir, 'admin.html')).exists()).toBe(false);
    expect(await Bun.file(join(distDir, 'admin.js')).exists()).toBe(false);
  });

  it('cannot reach the admin API, in dev or in production', async () => {
    const nginx = await readFile(join(import.meta.dir, '..', 'nginx.conf'), 'utf8');
    // nginx refuses the path outright rather than proxying it.
    expect(nginx).toMatch(/location \/api\/admin\/\s*\{\s*return 404;/);

    // The dev server refuses it too, so the two do not disagree.
    const build = await readFile(join(import.meta.dir, '..', 'build.ts'), 'utf8');
    expect(build).toContain("blockedApiPrefixes: ['/admin']");
  });
});
