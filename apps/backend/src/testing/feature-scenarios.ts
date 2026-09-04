import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const REPO_ROOT = join(import.meta.dir, '../../../..');
export const CONTRACTS_DIR = join(REPO_ROOT, 'contracts');
const SPEC_ROOTS = [join(REPO_ROOT, 'apps/backend/src'), join(REPO_ROOT, 'apps/frontend/src')];

/**
 * Feature files whose scenarios must be green in CI. Add a feature here in the
 * same commit that lands its implementation; until then its scenarios are
 * reported but not enforced, so unbuilt scope never blocks the build.
 */
export const ENFORCED_FEATURES = new Set(['canonicalize-v1.feature', 'provenance.feature']);

/** Tags that keep a scenario out of CI: a human runs these against mainnet. */
export const HUMAN_ONLY_TAGS = ['@mainnet', '@manual'];

export interface FeatureScenario {
  readonly feature: string;
  readonly name: string;
  /** Feature-level and scenario-level tags combined. */
  readonly tags: readonly string[];
  readonly outline: boolean;
}

const tagsOn = (line: string): string[] =>
  line.trim().startsWith('@') ? line.trim().split(/\s+/).filter((t) => t.startsWith('@')) : [];

/** Scenarios and Scenario Outlines, each carrying its own tags plus the Feature's. */
export function parseFeature(feature: string, gherkin: string): FeatureScenario[] {
  const scenarios: FeatureScenario[] = [];
  let featureTags: string[] = [];
  let pending: string[] = [];
  let seenFeature = false;

  for (const line of gherkin.split('\n')) {
    const tags = tagsOn(line);
    if (tags.length > 0) {
      pending = [...pending, ...tags];
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith('Feature:')) {
      featureTags = pending;
      pending = [];
      seenFeature = true;
      continue;
    }

    const declared = /^(Scenario Outline|Scenario):\s*(.+?)\s*$/.exec(trimmed);
    if (declared?.[2] && seenFeature) {
      scenarios.push({
        feature,
        name: declared[2],
        tags: [...new Set([...featureTags, ...pending])],
        outline: declared[1] === 'Scenario Outline',
      });
      pending = [];
      continue;
    }

    // Any other non-blank line ends a pending tag block that belonged to it.
    if (trimmed !== '') pending = [];
  }
  return scenarios;
}

export async function readFeatureScenarios(): Promise<FeatureScenario[]> {
  const files = (await readdir(CONTRACTS_DIR)).filter((f) => f.endsWith('.feature')).sort();
  const scenarios: FeatureScenario[] = [];
  for (const file of files) {
    scenarios.push(...parseFeature(file, await readFile(join(CONTRACTS_DIR, file), 'utf8')));
  }
  return scenarios;
}

/** True when CI must run this scenario: no human-only tag on it. */
export const runsInCi = (s: FeatureScenario): boolean =>
  !s.tags.some((tag) => HUMAN_ONLY_TAGS.includes(tag));

/** Names passed to scenario() across the suite, found by source scan so the
 *  result does not depend on which spec files a given test run imports. */
export async function readImplementedScenarioNames(): Promise<Set<string>> {
  const files: string[] = [];
  for (const root of SPEC_ROOTS) {
    for (const found of await readdir(root, { recursive: true })) {
      if (found.endsWith('.spec.ts') && !found.endsWith('scenario-coverage.spec.ts')) {
        files.push(join(root, found));
      }
    }
  }

  const names = new Set<string>();
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const [, , name] of source.matchAll(/\bscenario\(\s*(['"`])(.+?)\1/g)) {
      if (name) names.add(name);
    }
  }
  return names;
}
