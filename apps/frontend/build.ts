// The public site. Run from the repository root or this directory:
//   bun apps/frontend/build.ts                 one-shot build
//   bun apps/frontend/build.ts --watch --serve rebuild on change + dev server
import { createSite, runCli } from '@wuzzy/static-site';
import { site as config } from './src/site.config';

// The admin API is deliberately unreachable from the public site, in dev as
// well as in production (nginx.conf enforces the same rule). Admin is a
// separate app on its own origin so it can be kept off the public internet.
const options = {
  root: import.meta.dir,
  blockedApiPrefixes: ['/admin'],
  // The front door of a product whose customers are programs should be
  // readable by one. The admin app deliberately passes no discovery options.
  discovery: {
    origin: config.origin,
    description: config.description,
    indexable: config.indexable,
    notes: [
      `The API is metered with x402: an unpaid request to ${config.apiOrigin} answers HTTP 402 with the price.`,
      `Indexing costs ${config.pricePerPage} per page and a query costs ${config.queryPrice}, paid in USDC on ${config.networkLabel}.`,
      `Integration docs, including the payment handshake: ${config.docsOrigin}`,
    ],
  },
} as const;

export const site = createSite(options);
export const buildAll = site.buildAll;

if (import.meta.main) {
  await runCli(options, import.meta.path);
}
