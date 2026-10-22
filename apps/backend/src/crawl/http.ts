import { gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';
import { userAgent } from './user-agent';

export interface FetchedResource {
  readonly url: string;
  readonly status: number;
  readonly contentType: string | null;
  /** Exactly the bytes the origin sent. The raw hash commits to these. */
  readonly bytes: Uint8Array;
  /**
   * Set when a redirect pointed somewhere the guard refused. The hop is not
   * followed, so no request is ever made to that host.
   */
  readonly blockedRedirect?: string;
}

export type Fetcher = (url: string) => Promise<FetchedResource>;

/** Decides whether a redirect target may be requested at all. */
export type RedirectGuard = (url: string) => Promise<boolean>;

const MAX_REDIRECTS = 5;
const EMPTY = new Uint8Array();
const ACCEPT_ENCODING = 'gzip, deflate';

/** The origin compressed its answer in a coding the crawler did not ask for. */
export class UnrequestedEncodingError extends Error {}

function decodeBody(coding: string | null, body: Uint8Array): Uint8Array {
  switch ((coding ?? '').trim().toLowerCase()) {
    case '':
    case 'identity':
      return body;
    case 'gzip':
    case 'x-gzip':
      return new Uint8Array(gunzipSync(body));
    case 'deflate':
      // HTTP's deflate is zlib-wrapped, but some servers send it raw.
      try {
        return new Uint8Array(inflateSync(body));
      } catch {
        return new Uint8Array(inflateRawSync(body));
      }
    default:
      throw new UnrequestedEncodingError(`origin answered with content-encoding "${coding}", which was not requested`);
  }
}

/**
 * The only way this codebase talks to an origin. Every request carries the
 * honest user-agent, and the body is kept as bytes rather than a decoded
 * string: decoding and re-encoding would not reproduce the origin's bytes for a
 * page that is not UTF-8, and the raw hash has to commit to what was received.
 *
 * Redirects are followed manually rather than by `fetch`. Following them
 * automatically would let a 301 carry the crawler onto a host whose robots.txt
 * was never read, which is a request we are not entitled to make: the check has
 * to happen before each hop, not after the fact.
 *
 * Decoding is ours too. Only gzip and deflate are asked for, `fetch`'s own
 * decompression is off, and a body in any other coding fails the fetch with
 * UnrequestedEncodingError without being decoded.
 */
export function createFetcher(agent = userAgent(), guard?: RedirectGuard): Fetcher {
  return async (url: string): Promise<FetchedResource> => {
    let current = url;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetch(current, {
        headers: {
          'user-agent': agent,
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
          'accept-encoding': ACCEPT_ENCODING,
        },
        redirect: 'manual',
        decompress: false,
      });

      const location = response.headers.get('location');
      const isRedirect = response.status >= 300 && response.status < 400 && location;
      if (!isRedirect) {
        return {
          url: current,
          status: response.status,
          contentType: response.headers.get('content-type'),
          bytes: decodeBody(response.headers.get('content-encoding'), new Uint8Array(await response.arrayBuffer())),
        };
      }

      const next = new URL(location, current).toString();
      if (guard && !(await guard(next))) {
        return { url: current, status: response.status, contentType: null, bytes: EMPTY, blockedRedirect: next };
      }
      current = next;
    }

    // A redirect loop is a broken site, not something to keep chasing.
    return { url: current, status: 508, contentType: null, bytes: EMPTY };
  };
}
