import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildAll } from '../build';

describe('admin static build', () => {
  it('pre-renders a page per view, each carrying the nav and the noindex rule', async () => {
    const written = await buildAll();
    const distDir = join(import.meta.dir, '..', 'dist');

    // A page per view rather than one long scroll; the nav is shared, so a
    // page that forgot noindex or the nav would be a page reachable on its own.
    const pages = ['index', 'indexes', 'documents', 'document', 'activity'];
    expect(written.length).toBe(pages.length);
    for (const name of pages) {
      const html = await Bun.file(join(distDir, `${name}.html`)).text();
      expect(html).toStartWith('<!doctype html>');
      expect(html).toContain('noindex');
      expect(html).toContain('data-nav');
      expect(html).toContain('id="admin-error"');
    }

    const index = await Bun.file(join(distDir, 'index.html')).text();
    expect(index).toContain('<title>Wuzzy admin</title>');
    expect(index).toContain('id="stats"');
    expect(await Bun.file(join(distDir, 'documents.html')).text()).toContain('id="doc-filter"');
    expect(await Bun.file(join(distDir, 'activity.html')).text()).toContain('id="act-filter"');

    // Content-addressed, and every reference resolves.
    const assets = [...index.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]!);
    expect(assets).toEqual(expect.arrayContaining([expect.stringMatching(/^\/admin\.[0-9a-f]{8}\.js$/)]));
    expect(assets).toEqual(expect.arrayContaining([expect.stringMatching(/^\/styles\.[0-9a-f]{8}\.css$/)]));
    for (const asset of assets) {
      expect(await Bun.file(join(distDir, asset)).exists()).toBe(true);
    }
  });

  it('is served on its own origin, proxying only the admin API', async () => {
    const nginx = await readFile(join(import.meta.dir, '..', 'nginx.conf'), 'utf8');

    // Only /api/admin/ is proxied: the public endpoints are not reachable here.
    expect(nginx).toContain('location /api/admin/');
    expect(nginx).not.toContain('location /api/ {');
    expect(nginx).toContain('noindex');

    // An operator tool caches nothing, so its stale-asset risk is zero and it
    // does not need the public site's long-lived immutable caching.
    expect(nginx).toContain('no-store');
  });
});
