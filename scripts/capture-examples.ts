// Captures the HTTP exchanges the homepage prints, from a running API.
//
// The page shows a 402 handshake as evidence that the meter is real. Evidence
// typed into a template is not evidence, and it goes stale silently: the price,
// the network, the asset and the field names all come from configuration the
// page cannot see. So the exchange is captured from an actual server and the
// build reads the capture.
//
// Run against the metered demo backend:
//   podman compose -f compose.demo.yml up -d
//   bun run capture-examples
//
// Re-running is expected. Volatile headers are dropped and the result is
// pretty-printed, so an unchanged API produces an unchanged file and the diff
// shows only what actually moved.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = process.env.CAPTURE_API_ORIGIN ?? 'http://localhost:3001';
const OUT = join(import.meta.dir, '..', 'fixtures', 'examples');

/** The seeds the commissioning example quotes for. Shape, not a real site. */
const SEED_PAGES = 392;

/**
 * Headers that change on every request and carry nothing the page renders.
 * Keeping them would make every capture a diff and every diff meaningless.
 */
const VOLATILE = new Set(['date', 'etag', 'content-length', 'keep-alive', 'connection']);

export interface Capture {
  /** The request, as the page prints it. */
  readonly request: { readonly method: string; readonly path: string; readonly body: unknown };
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

async function capture(method: string, path: string, body: unknown): Promise<Capture> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const headers: Record<string, string> = {};
  for (const [name, value] of response.headers) {
    if (!VOLATILE.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
  }

  return {
    request: { method, path, body },
    status: response.status,
    statusText: response.statusText,
    headers,
    body: await response.json(),
  };
}

/** A page's worth of seed URLs, so the quote is for a realistic page count. */
function seeds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `https://docs.yourprotocol.xyz/page-${i + 1}`);
}

const CAPTURES: Record<string, () => Promise<Capture>> = {
  // The commissioning quote. This is the one the transcript block prints.
  'indexes-402': () => capture('POST', '/indexes', { urls: seeds(SEED_PAGES) }),
  // The per-query meter, for the same handshake on the read side.
  'search-402': () => capture('POST', '/search', { query: 'staking rewards formula', topK: 5 }),
};

if (import.meta.main) {
  await mkdir(OUT, { recursive: true });

  const reachable = await fetch(`${API}/healthz`).then(
    (r) => r.ok,
    () => false,
  );
  if (!reachable) {
    console.error(`No API at ${API}. Start it first:\n  podman compose -f compose.demo.yml up -d`);
    process.exit(1);
  }

  for (const [name, run] of Object.entries(CAPTURES)) {
    const result = await run();
    await writeFile(join(OUT, `${name}.json`), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`${name}: ${result.status} ${result.statusText}`);
  }
}
