import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { brotliCompressSync, deflateRawSync, deflateSync, gzipSync } from 'node:zlib';
import { createFetcher, UnrequestedEncodingError } from './http';

const PAGE = '<!doctype html><title>Encoded</title><p>The same page in every coding.</p>';

const RESPONSES: Record<string, { coding?: string; body: string | Uint8Array }> = {
  '/identity': { body: PAGE },
  '/gzip': { coding: 'gzip', body: gzipSync(PAGE) },
  '/deflate': { coding: 'deflate', body: deflateSync(PAGE) },
  '/raw-deflate': { coding: 'deflate', body: deflateRawSync(PAGE) },
  '/br': { coding: 'br', body: brotliCompressSync(PAGE) },
};

let server: Server;
let origin: string;
const acceptEncodings: (string | undefined)[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    acceptEncodings.push(request.headers['accept-encoding']);
    const served = RESPONSES[request.url ?? ''];
    if (served === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html',
      ...(served.coding ? { 'content-encoding': served.coding } : {}),
    });
    response.end(served.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port assigned');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('content-codings', () => {
  const fetcher = createFetcher();
  const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

  it('asks for gzip and deflate only', async () => {
    await fetcher(`${origin}/identity`);
    expect(acceptEncodings.at(-1)).toBe('gzip, deflate');
  });

  for (const path of ['/identity', '/gzip', '/deflate', '/raw-deflate']) {
    it(`returns the page the origin sent for ${path.slice(1)}`, async () => {
      expect(text((await fetcher(`${origin}${path}`)).bytes)).toBe(PAGE);
    });
  }

  it('refuses a coding it did not ask for', async () => {
    const error = await fetcher(`${origin}/br`).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnrequestedEncodingError);
    expect((error as Error).message).toContain('content-encoding "br"');
  });
});
