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
import { readSeeds } from '../crawl/seeds';
import { embedPending } from '../embed/embed';
import { attestPending, createEasSubmitter, MissingAttesterKeyError } from '../attest/attestor';
import { formatVerifyResult, verify } from '../verify/verify';

const USAGE = `wuzzy - provable crawl pipeline

  wuzzy crawl [seed-url]...   crawl seeds and write the provenance trail
                              with no URLs, reads seeds.json
                              --max=<n> caps pages fetched in total
                              --per-host=<n> caps pages fetched from each host
  wuzzy embed                 embed every document the crawler left pending
  wuzzy attest                attest every embedded document that has no UID yet
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
        const maxFlag = args.find((arg) => arg.startsWith('--max='));
        const given = args.filter((arg) => !arg.startsWith('--'));
        // No URLs means the curated list, so a real crawl is reproducible
        // without anyone having to remember what it was built from.
        const seeds = given.length > 0 ? given : await readSeeds();
        if (given.length === 0) {
          console.log(`seeds.json: ${seeds.length} host(s)`);
        }
        const maxRequests = maxFlag ? Number(maxFlag.slice('--max='.length)) : undefined;
        if (maxRequests !== undefined && (!Number.isFinite(maxRequests) || maxRequests < 1)) {
          console.error('--max must be a positive number');
          return 1;
        }
        const perHostFlag = args.find((arg) => arg.startsWith('--per-host='));
        const maxPerHost = perHostFlag ? Number(perHostFlag.slice('--per-host='.length)) : undefined;
        if (maxPerHost !== undefined && (!Number.isFinite(maxPerHost) || maxPerHost < 1)) {
          console.error('--per-host must be a positive number');
          return 1;
        }
        const summary = await crawl(dataSource, { seeds, maxRequests, maxPerHost });
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
      case 'attest': {
        // Run by a human with a funded key in their own environment. Nothing
        // here supplies or defaults one.
        let submitter;
        try {
          submitter = createEasSubmitter();
        } catch (error) {
          if (error instanceof MissingAttesterKeyError) {
            console.error(error.message);
            return 1;
          }
          throw error;
        }
        const summary = await attestPending(dataSource, { submitter });
        console.log(`attested ${summary.attested} document(s) in ${summary.batches} batch(es)`);
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
