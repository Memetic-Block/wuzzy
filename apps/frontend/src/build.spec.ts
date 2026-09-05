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
    expect(index).toContain('id="pager"');

    // Assets are content-addressed and the page points at the hashed names, so
    // a long-cached browser cannot keep running a previous build's script.
    const assets = [...index.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]!);
    expect(assets).toEqual(expect.arrayContaining([expect.stringMatching(/^\/search\.[0-9a-f]{8}\.js$/)]));
    expect(assets).toEqual(expect.arrayContaining([expect.stringMatching(/^\/htmx\.min\.[0-9a-f]{8}\.js$/)]));
    expect(assets).toEqual(expect.arrayContaining([expect.stringMatching(/^\/styles\.[0-9a-f]{8}\.css$/)]));

    // Every one of them resolves: the unhashed originals are gone, so a missed
    // rewrite would be a 404 rather than a stale file.
    for (const asset of assets) {
      expect(await Bun.file(join(distDir, asset)).exists()).toBe(true);
    }
    expect(await Bun.file(join(distDir, 'search.js')).exists()).toBe(false);

    // Tailwind compiled and picked up classes used in the pages.
    const stylesheet = assets.find((asset) => asset.endsWith('.css'))!;
    expect(await Bun.file(join(distDir, stylesheet)).text()).toContain('.mx-auto');

    // The admin UI is a separate app; nothing about it ships with the public site.
    expect(await Bun.file(join(distDir, 'admin.html')).exists()).toBe(false);
    expect(assets.some((asset) => asset.includes('admin'))).toBe(false);
  });

  it('gives an unchanged asset the same name, so caches still hit', async () => {
    const distDir = join(import.meta.dir, '..', 'dist');
    const nameOf = async () => {
      await buildAll();
      const index = await Bun.file(join(distDir, 'index.html')).text();
      return /src="(\/search\.[0-9a-f]{8}\.js)"/.exec(index)?.[1];
    };

    // Content addressing is only worth having if it is stable: a rebuild that
    // changed nothing must not invalidate every visitor's cache.
    expect(await nameOf()).toBe((await nameOf())!);
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
