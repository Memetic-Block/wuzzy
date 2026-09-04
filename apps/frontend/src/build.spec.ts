import { describe, expect, it } from 'bun:test';
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
  });
});
