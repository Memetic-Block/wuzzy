import { userAgent } from './user-agent';

export interface FetchedResource {
  readonly url: string;
  readonly status: number;
  readonly contentType: string | null;
  /** Exactly the bytes the origin sent. The raw hash commits to these. */
  readonly bytes: Uint8Array;
}

export type Fetcher = (url: string) => Promise<FetchedResource>;

/**
 * The only way this codebase talks to an origin. Every request carries the
 * honest user-agent, and the body is kept as bytes rather than a decoded
 * string: decoding and re-encoding would not reproduce the origin's bytes for a
 * page that is not UTF-8, and the raw hash has to commit to what was received.
 */
export function createFetcher(agent = userAgent()): Fetcher {
  return async (url: string): Promise<FetchedResource> => {
    const response = await fetch(url, {
      headers: { 'user-agent': agent, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9' },
      redirect: 'follow',
    });
    return {
      url: response.url || url,
      status: response.status,
      contentType: response.headers.get('content-type'),
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  };
}
