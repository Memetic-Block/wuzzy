import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { buildAll } from '../build';

describe('static build', () => {
  it('pre-renders pages with htmx wiring intact', async () => {
    const written = await buildAll();
    expect(written.length).toBeGreaterThan(0);

    const distDir = join(import.meta.dir, '..', 'dist');
    const index = await Bun.file(join(distDir, 'index.html')).text();
    expect(index).toStartWith('<!doctype html>');
    expect(index).toContain('hx-get="/api/hello"');
    expect(index).toContain('htmx.min.js');

    expect(await Bun.file(join(distDir, 'htmx.min.js')).exists()).toBe(true);

    // Tailwind compiled and picked up classes used in the pages.
    const styles = await Bun.file(join(distDir, 'styles.css')).text();
    expect(styles).toContain('.mx-auto');
  });
});
