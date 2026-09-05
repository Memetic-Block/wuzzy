// The public site. Run from the repository root or this directory:
//   bun apps/frontend/build.ts                 one-shot build
//   bun apps/frontend/build.ts --watch --serve rebuild on change + dev server
import { createSite, runCli } from '@wuzzy/static-site';

// The admin API is deliberately unreachable from the public site, in dev as
// well as in production (nginx.conf enforces the same rule). Admin is a
// separate app on its own origin so it can be kept off the public internet.
const options = {
  root: import.meta.dir,
  blockedApiPrefixes: ['/admin'],
} as const;

export const site = createSite(options);
export const buildAll = site.buildAll;

if (import.meta.main) {
  await runCli(options, import.meta.path);
}
