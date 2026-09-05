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

    expect(await Bun.file(join(distDir, 'admin.js')).exists()).toBe(true);
    expect(await Bun.file(join(distDir, 'styles.css')).exists()).toBe(true);
  });

  it('is served on its own origin, proxying only the admin API', async () => {
    const nginx = await readFile(join(import.meta.dir, '..', 'nginx.conf'), 'utf8');

    // Only /api/admin/ is proxied: the public endpoints are not reachable here.
    expect(nginx).toContain('location /api/admin/');
    expect(nginx).not.toContain('location /api/ {');
    expect(nginx).toContain('noindex');
  });
});
