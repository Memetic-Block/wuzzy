/**
 * Prints contract scenario coverage by feature. Enforced features must be fully
 * covered or `bun test` fails; the rest is a backlog view.
 *   bun run scenarios
 */
import {
  ENFORCED_FEATURES,
  readFeatureScenarios,
  readImplementedScenarioNames,
  runsInCi,
} from '../apps/backend/src/testing/feature-scenarios';

const contract = await readFeatureScenarios();
const implemented = await readImplementedScenarioNames();

let covered = 0;
let inCi = 0;

for (const feature of [...new Set(contract.map((s) => s.feature))]) {
  const enforced = ENFORCED_FEATURES.has(feature);
  console.log(`\n${feature}${enforced ? '  (enforced in CI)' : ''}`);
  for (const s of contract.filter((x) => x.feature === feature)) {
    if (!runsInCi(s)) {
      console.log(`  [-] ${s.name}  ${s.tags.join(' ')}`);
      continue;
    }
    inCi += 1;
    const hit = implemented.has(s.name);
    if (hit) covered += 1;
    console.log(`  [${hit ? 'x' : ' '}] ${s.name}`);
  }
}

console.log(`\n${covered}/${inCi} CI scenarios covered by tests.`);
console.log('[-] marks scenarios a human runs by hand; CI never claims them.');

const gaps = contract.filter(
  (s) => ENFORCED_FEATURES.has(s.feature) && runsInCi(s) && !implemented.has(s.name),
);
if (gaps.length > 0) {
  console.error(`\nEnforced features with uncovered scenarios: ${gaps.length}`);
  process.exit(1);
}
