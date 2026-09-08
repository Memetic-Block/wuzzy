// Flattens the design export into a plain HTML file you can open in a browser.
//
// docs/design/Wuzzy_Homepage.dc.html is a design-tool export: its markup is
// wrapped in <x-dc>, its conditionals are <sc-if>, its lists are <sc-for>, and
// the runtime that resolves them (support.js) was not exported with it. So it
// renders as a blank page, and there is no PNG beside it either.
//
// This resolves the export the way its own placeholder hints say it should
// resolve, using the sample data from its embedded script, and writes a static
// file. That gives the redesign something to be compared against: open the
// output next to the built page at the same width.
//
// It is a reading aid, not a build input. Nothing in apps/ imports it.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DESIGN = join(import.meta.dir, '..', 'docs', 'design', 'Wuzzy_Homepage.dc.html');
const OUT = join(import.meta.dir, '..', 'docs', 'design', 'reference-render.html');

/** The opening state: two samples, both markers on, badge on. */
const SAMPLES = [
  {
    title: 'Accepting x402 payments in an Express app',
    snippet:
      'Add the payment middleware to any route. Unpaid requests receive HTTP 402 with the price and pay-to address; paid requests settle in USDC on Base…',
    hash: '0x8f3a…c41d',
    fetched: '2026-09-05 14:02 UTC',
  },
  {
    title: 'EIP-3009: transfer with authorization',
    snippet:
      "Enables gasless USDC transfers by letting the recipient or a third party submit a signed authorization on the payer's behalf…",
    hash: '0x2b91…77e0',
    fetched: '2026-09-05 13:47 UTC',
  },
];

const VALUES: Record<string, string> = {
  ledgerCaption: 'SAMPLE RESULTS — CAPTURED FROM THE LIVE API',
  query: '',
};

function flatten(source: string): string {
  let html = source;

  // The embedded logic and the missing runtime are both scaffolding.
  html = html.replace(/<script\s+type="text\/x-dc"[\s\S]*?<\/script>/g, '');
  html = html.replace(/<script\s+src="\.\/support\.js"><\/script>/g, '');

  // <helmet> carries the real stylesheet; keep its contents, drop the wrapper.
  html = html.replace(/<\/?helmet>/g, '');
  html = html.replace(/<\/?x-dc>/g, '');

  // A conditional resolves to its own placeholder hint, which is what the
  // design tool shows by default and therefore what was approved.
  html = html.replace(
    /<sc-if\s+value="\{\{[^}]*\}\}"\s+hint-placeholder-val="\{\{\s*(true|false)\s*\}\}"\s*>([\s\S]*?)<\/sc-if>/g,
    (_all, shown: string, body: string) => (shown === 'true' ? body : ''),
  );

  // A list repeats its body once per placeholder row, with that row's fields.
  html = html.replace(
    /<sc-for\s+list="\{\{[^}]*\}\}"\s+as="(\w+)"\s+hint-placeholder-count="(\d+)"\s*>([\s\S]*?)<\/sc-for>/g,
    (_all, alias: string, count: string, body: string) =>
      SAMPLES.slice(0, Number(count))
        .map((row) =>
          body.replace(
            new RegExp(`\\{\\{\\s*${alias}\\.(\\w+)\\s*\\}\\}`, 'g'),
            (_m, field: string) => String((row as Record<string, string>)[field] ?? ''),
          ),
        )
        .join(''),
  );

  // Remaining bindings take their value from the opening state.
  html = html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_all, name: string) => VALUES[name] ?? '');

  // Design-tool-only attributes, and the handlers they hung off.
  html = html.replace(/\s+style-hover="[^"]*"/g, '');
  html = html.replace(/\s+(?:onSubmit|onChange)=""/g, '');
  html = html.replace(/\s+hint-placeholder-\w+="[^"]*"/g, '');

  // The brand files live in the frontend, and this is opened from disk.
  html = html.replace(/src="(wuzzy-[\w-]+\.png)"/g, 'src="../../apps/frontend/public/brand/$1"');

  return html;
}

if (import.meta.main) {
  const source = await Bun.file(DESIGN).text();
  const rendered = flatten(source);

  const leftovers = rendered.match(/<sc-\w+|\{\{|<x-dc|<helmet/g);
  if (leftovers) {
    console.error(`unresolved scaffolding remains: ${[...new Set(leftovers)].join(', ')}`);
    process.exit(1);
  }

  await writeFile(OUT, rendered);
  console.log(`wrote ${OUT}`);
}
