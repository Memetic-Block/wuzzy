#!/usr/bin/env bun
/**
 * The wuzzy pipeline CLI. Stages are commands rather than queue workers, so a
 * run is something a human starts, watches and can re-run idempotently.
 *
 *   bun run wuzzy crawl <seed-url>...
 *   bun run wuzzy verify <url>
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../database/typeorm.config';
import { crawl } from '../crawl/crawler';
import { embedPending } from '../embed/embed';
import { formatVerifyResult, verify } from '../verify/verify';

const USAGE = `wuzzy - provable crawl pipeline

  wuzzy crawl <seed-url>...   crawl seeds and write the provenance trail
  wuzzy embed                 embed every document the crawler left pending
  wuzzy verify <url>          re-derive the hash for one indexed URL

verify exit codes: 0 match, 1 mismatch, 2 not indexed
`;

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...args] = argv;

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  const dataSource = await new DataSource(buildDataSourceOptions()).initialize();
  try {
    switch (command) {
      case 'crawl': {
        if (args.length === 0) {
          console.error('crawl needs at least one seed URL');
          return 1;
        }
        const summary = await crawl(dataSource, { seeds: args });
        console.log(
          `created ${summary.created}  changed ${summary.changed}  ` +
            `unchanged ${summary.unchanged}  skipped ${summary.skipped}  failed ${summary.failed}`,
        );
        return summary.failed > 0 ? 1 : 0;
      }
      case 'embed': {
        const summary = await embedPending(dataSource);
        console.log(`embedded ${summary.documents} document(s), ${summary.chunks} chunk(s)`);
        return 0;
      }
      case 'verify': {
        const url = args[0];
        if (!url) {
          console.error('verify needs a URL');
          return 1;
        }
        const result = await verify(dataSource, url);
        console.log(formatVerifyResult(result));
        return result.exitCode;
      }
      default:
        console.error(`unknown command "${command}"\n\n${USAGE}`);
        return 1;
    }
  } finally {
    await dataSource.destroy();
  }
}

if (import.meta.main) {
  process.exit(await main(Bun.argv.slice(2)));
}

export { main };
