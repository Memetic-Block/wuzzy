// The admin site. A separate app on its own origin, so it can be kept off the
// public internet entirely rather than hidden behind a path on the public site.
//   bun apps/admin/build.ts --watch --serve
import { createSite, runCli } from '@wuzzy/static-site';

const options = {
  root: import.meta.dir,
  port: Number(process.env.ADMIN_PORT ?? 8081),
} as const;

export const site = createSite(options);
export const buildAll = site.buildAll;

if (import.meta.main) {
  await runCli(options, import.meta.path);
}
