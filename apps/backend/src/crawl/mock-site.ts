import { createServer, type Server } from 'node:http';

export interface MockSite {
  readonly origin: string;
  /** Every request the site received, in order, with the agent that made it. */
  readonly requests: { url: string; userAgent: string | undefined }[];
  setPage(path: string, html: string): void;
  /** Makes `path` answer 302 to `target`, for redirect scenarios. */
  redirect(path: string, target: string): void;
  close(): Promise<void>;
}

/** A site the crawler can be pointed at, so scenarios never touch the network. */
export async function startMockSite(pages: Record<string, string>): Promise<MockSite> {
  const served = { ...pages };
  const redirects: Record<string, string> = {};
  const requests: { url: string; userAgent: string | undefined }[] = [];

  const server: Server = createServer((request, response) => {
    const path = (request.url ?? '/').split('#')[0] ?? '/';
    requests.push({ url: path, userAgent: request.headers['user-agent'] });

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
    response.writeHead(200, { 'content-type': contentType });
    response.end(body);
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
