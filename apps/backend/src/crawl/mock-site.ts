import { createServer, type Server } from 'node:http';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';

export type ContentCoding = 'gzip' | 'deflate' | 'br';

const COMPRESS: Record<ContentCoding, (body: string) => Uint8Array> = {
  gzip: (body) => gzipSync(body),
  deflate: (body) => deflateSync(body),
  br: (body) => brotliCompressSync(body),
};

export interface MockRequest {
  readonly url: string;
  readonly userAgent: string | undefined;
  readonly acceptEncoding: string | undefined;
}

export interface MockSite {
  readonly origin: string;
  /** Every request the site received, in order, with the headers it was sent with. */
  readonly requests: MockRequest[];
  setPage(path: string, html: string): void;
  /** Makes `path` answer 302 to `target`, for redirect scenarios. */
  redirect(path: string, target: string): void;
  /**
   * Makes `path` answer compressed in `coding` whatever the request asked
   * for, as a server that ignores Accept-Encoding would.
   */
  encode(path: string, coding: ContentCoding): void;
  close(): Promise<void>;
}

/** A site the crawler can be pointed at, so scenarios never touch the network. */
export async function startMockSite(pages: Record<string, string>): Promise<MockSite> {
  const served = { ...pages };
  const redirects: Record<string, string> = {};
  const encodings: Record<string, ContentCoding> = {};
  const requests: MockRequest[] = [];

  const server: Server = createServer((request, response) => {
    const path = (request.url ?? '/').split('#')[0] ?? '/';
    requests.push({
      url: path,
      userAgent: request.headers['user-agent'],
      acceptEncoding: request.headers['accept-encoding'],
    });

    const target = redirects[path];
    if (target !== undefined) {
      response.writeHead(302, { location: target });
      response.end();
      return;
    }

    const body = served[path];
    if (body === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
      return;
    }
    const contentType = path.endsWith('.xml')
      ? 'application/xml'
      : path.endsWith('.txt')
        ? 'text/plain'
        : 'text/html; charset=utf-8';
    const coding = encodings[path];
    if (coding === undefined) {
      response.writeHead(200, { 'content-type': contentType });
      response.end(body);
      return;
    }
    response.writeHead(200, { 'content-type': contentType, 'content-encoding': coding });
    response.end(COMPRESS[coding](body));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port assigned');

  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    setPage: (path, html) => {
      served[path] = html;
    },
    redirect: (path, target) => {
      redirects[path] = target;
    },
    encode: (path, coding) => {
      encodings[path] = coding;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A page with enough prose to clear the thin-page threshold. */
export const page = (title: string, body: string, links: readonly string[] = []): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body><header><nav><a href="/">Home</a></nav></header><main><article>
<h1>${title}</h1>
<p>${body}</p>
${links.map((href) => `<a href="${href}">${href}</a>`).join('\n')}
</article></main><footer><p>Copyright 2025.</p></footer></body></html>`;

export const PROSE =
  'This page carries enough prose for the extractor to treat it as an article rather ' +
  'than as navigation, which keeps it above the thin-page threshold and gives the ' +
  'canonicalizer something stable to hash across repeated fetches of the same content.';
