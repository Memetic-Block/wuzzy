import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildAll } from '../build';

describe('admin static build', () => {
  it('pre-renders the admin page and its script', async () => {
    const written = await buildAll();
    expect(written.length).toBeGreaterThan(0);

    const distDir = join(import.meta.dir, '..', 'dist');
    const index = await Bun.file(join(distDir, 'index.html')).text();
    expect(index).toStartWith('<!doctype html>');
    expect(index).toContain('<title>Wuzzy admin</title>');
    expect(index).toContain('id="stats"');
    // An operator tool must not be indexable.
    expect(index).toContain('noindex');

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
