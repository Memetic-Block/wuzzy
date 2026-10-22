import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import 'reflect-metadata';
import { Body, Controller, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { useBodyParsers } from './body-parsers';

@Controller('echo')
class EchoController {
  @Post()
  echo(@Body() body: unknown): unknown {
    return body;
  }
}

let app: NestExpressApplication;
let url: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ controllers: [EchoController] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  useBodyParsers(app);
  await app.listen(0);
  url = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/echo`;
});

afterAll(async () => {
  await app.close();
});

const BODY = JSON.stringify({ urls: ['https://example.com/'] });

const post = (body: BodyInit, contentEncoding?: string): Promise<Response> =>
  fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(contentEncoding ? { 'content-encoding': contentEncoding } : {}),
    },
    body,
  });

describe('request bodies', () => {
  it('parses an uncompressed body', async () => {
    const response = await post(BODY);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(JSON.parse(BODY));
  });

  it('refuses a Brotli body with 415', async () => {
    expect((await post(new Uint8Array(brotliCompressSync(BODY)), 'br')).status).toBe(415);
  });

  it('refuses a gzip body with 415', async () => {
    expect((await post(new Uint8Array(gzipSync(BODY)), 'gzip')).status).toBe(415);
  });
});
