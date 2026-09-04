import { it } from 'bun:test';

/**
 * Declares that this test implements a Gherkin scenario from contracts/.
 * The name must match the feature file verbatim; scenario-coverage.spec.ts
 * enforces that in both directions, so a renamed scenario fails the build
 * rather than silently losing its test.
 */
export function scenario(
  name: string,
  body: () => void | Promise<void>,
  timeoutMs?: number,
): void {
  it(name, body, timeoutMs);
}
