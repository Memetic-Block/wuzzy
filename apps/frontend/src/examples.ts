// The 402 handshake the page prints, rendered from a captured exchange.
//
// The capture (fixtures/examples/, written by `bun run capture-examples`) is
// the evidence: it proves the field names, the status line and the arithmetic
// are the server's and not a copywriter's. What it cannot supply is *this*
// deployment's origin, network and receiving address, because it was taken
// against whichever API was running. Those come from site.config, so the block
// is captured in shape and configured in substance, and neither half can drift
// into fiction on its own.
//
// The projection below elides; it never invents. Every value printed appears
// in the capture or in the configuration, and anything dropped is marked `…`.
import capture from '../../../fixtures/examples/indexes-402.json';
import { site } from './site.config';

interface Acceptance {
  readonly scheme: string;
  readonly network: string;
  readonly maxAmountRequired: string;
  readonly description: string;
}

interface Capture {
  readonly request: { readonly method: string; readonly path: string; readonly body: unknown };
  readonly status: number;
  readonly statusText: string;
  readonly body: { readonly x402Version: number; readonly accepts: readonly Acceptance[] };
}

const quote = capture as Capture;
const accepted = quote.body.accepts[0];
if (!accepted) throw new Error('captured 402 has no acceptance; re-run capture-examples');

const urls = (quote.request.body as { urls?: readonly string[] }).urls ?? [];

/** The transcript's three parts, so the status line can be coloured alone. */
export const transcript = {
  label: 'SESSION TRANSCRIPT',
  origin: new URL(site.apiOrigin).host,

  request: `$ curl -i -X POST ${site.apiOrigin}${quote.request.path} \\
    -d '{"urls":[ … ${urls.length} urls ]}'`,

  status: `HTTP/1.1 ${quote.status} ${quote.statusText}`,

  // Wrapped by hand at the design block's measure rather than by
  // JSON.stringify, which would either run long or lose the shape.
  body: `{ "x402Version": ${quote.body.x402Version}, "accepts": [ { "scheme": "${accepted.scheme}",
    "network": "${site.network}", "maxAmountRequired": "${accepted.maxAmountRequired}",
    "payTo": "${site.payTo ?? '0x…'}", … } ] }`,

  next: `$ # pay with any x402 client, then:
$ curl -X POST ${site.apiOrigin}/search -d '{"query":"staking rewards formula"}'`,
} as const;
