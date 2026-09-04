import { describe, expect, it } from 'bun:test';
import {
  ENFORCED_FEATURES,
  type FeatureScenario,
  readFeatureScenarios,
  readImplementedScenarioNames,
  runsInCi,
} from './feature-scenarios';

const describeScenario = (s: FeatureScenario) => `${s.feature}: ${s.name}`;

describe('contract scenario coverage', () => {
  it('every CI scenario in an enforced feature has a test', async () => {
    const contract = await readFeatureScenarios();
    const implemented = await readImplementedScenarioNames();

    const missing = contract
      .filter((s) => ENFORCED_FEATURES.has(s.feature) && runsInCi(s))
      .filter((s) => !implemented.has(s.name))
      .map(describeScenario);

    expect(missing).toEqual([]);
  });

  it('every scenario test matches a feature file verbatim', async () => {
    const contract = await readFeatureScenarios();
    const contractNames = new Set(contract.map((s) => s.name));
    const implemented = await readImplementedScenarioNames();

    // Catches renamed, typo'd, or unilaterally invented scenarios. The feature
    // files are the spec of record: change them there first.
    const unknown = [...implemented].filter((name) => !contractNames.has(name));

    expect(unknown).toEqual([]);
  });

  it('no human-only scenario is claimed by an automated test', async () => {
    const contract = await readFeatureScenarios();
    const implemented = await readImplementedScenarioNames();

    // @mainnet/@manual scenarios are run by hand against Base mainnet with a
    // funded key. A test asserting one of them would be lying about what ran.
    const claimed = contract
      .filter((s) => !runsInCi(s) && implemented.has(s.name))
      .map(describeScenario);

    expect(claimed).toEqual([]);
  });

  it('the feature files parse into tagged scenarios', async () => {
    const contract = await readFeatureScenarios();

    // Guards the parser itself: a contracts/ restructure that silently yields
    // zero scenarios would otherwise make the checks above vacuously pass.
    expect(contract.length).toBeGreaterThan(0);
    for (const feature of ENFORCED_FEATURES) {
      expect(contract.some((s) => s.feature === feature)).toBe(true);
    }
    // Scenario names are the join key across files, so they have to be unique.
    const names = contract.map((s) => s.name);
    expect(names).toEqual([...new Set(names)]);
  });
});
