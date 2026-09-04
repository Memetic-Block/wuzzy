import { afterEach, describe, expect, it } from 'bun:test';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

/**
 * Boots the real module graph, wired exactly as `bun src/main.ts` wires it.
 *
 * The other specs inject services directly, so they never exercise the
 * injector. A provider that no token resolves fails only at startup, which
 * means without this the first thing to notice would be the deployed container.
 */
let app: INestApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/**
 * Only an unreachable database is a reason to skip. Anything else, a wiring
 * error above all, has to fail: skipping on it would hide exactly what this
 * test exists to catch.
 */
const isDatabaseUnreachable = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|connect/i.test(message);
};

describe('AppModule', () => {
  it('resolves every provider and serves /healthz', async () => {
    try {
      const compiled = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = compiled.createNestApplication();
      await app.init();
    } catch (error) {
      if (process.env.CI || !isDatabaseUnreachable(error)) throw error;
      console.log('skipped: database unreachable');
      return;
    }

    await app.listen(0);
    const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');

    const response = await fetch(`${url}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
