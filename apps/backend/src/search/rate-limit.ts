/**
 * Client identification and request counting for the unmetered `/web-search`.
 *
 * `/search` needs none of this: payment is its gate, and an agent that pays is
 * welcome to ask as often as it likes. The free route has no such gate, so it
 * gets a cheap one that costs no dependency and no shared state.
 */

/** Windows retained before expired ones are swept. Bounds memory, nothing else. */
const MAX_KEYS = 50_000;

export interface RateLimitVerdict {
  readonly allowed: boolean;
  /** Seconds until the current window resets, for a Retry-After header. */
  readonly retryAfter: number;
}

/**
 * A fixed-window counter held in this process.
 *
 * Per replica rather than per cluster, so N replicas allow N times the limit.
 * That is the right trade here: the point is to stop one client hammering a
 * free endpoint, not to meter it precisely, and a shared counter would put a
 * broker in a stack that deliberately has none. Metering is what `/search` is
 * for.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records a request and reports whether it is within the limit. */
  check(key: string, now: number = Date.now()): RateLimitVerdict {
    if (this.windows.size >= MAX_KEYS) this.sweep(now);

    let window = this.windows.get(key);
    if (!window || now >= window.resetAt) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;

    return {
      allowed: window.count <= this.limit,
      retryAfter: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
    };
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) this.windows.delete(key);
    }
    // Every window is still live, so expiry alone cannot bound the map. Drop
    // the oldest half rather than grow without limit; the cost of being wrong
    // is that a handful of clients get their allowance back early.
    if (this.windows.size >= MAX_KEYS) {
      const excess = this.windows.size - Math.floor(MAX_KEYS / 2);
      let removed = 0;
      for (const key of this.windows.keys()) {
        if (removed++ >= excess) break;
        this.windows.delete(key);
      }
    }
  }
}

/**
 * The address to attribute a request to, counted from the right of
 * `X-Forwarded-For`.
 *
 * The leftmost entry is whatever the client claimed and is free to invent, so
 * keying on it hands anyone an unlimited allowance. Each proxy appends the
 * address it actually saw, so the entry `proxyHops` from the right is the one
 * our own edge observed and the client could not choose. Set the hop count to
 * match the deployment: one for nginx alone, two behind a CDN in front of it.
 */
export function clientIp(
  forwardedFor: string | undefined,
  remoteAddress: string | undefined,
  proxyHops: number,
): string {
  if (proxyHops > 0 && forwardedFor) {
    const hops = forwardedFor.split(',').map((entry) => entry.trim()).filter(Boolean);
    const observed = hops[hops.length - proxyHops];
    if (observed) return observed;
  }
  return remoteAddress ?? 'unknown';
}

/**
 * Drops the host part of an address: the last octet of an IPv4, the last four
 * groups of an IPv6.
 *
 * The privacy policy says full addresses are not stored, and this is what makes
 * that true of the rate limiter rather than merely intended. It coarsens the
 * limit to a /24 or a /64, which for abuse control is close enough.
 */
export function anonymizeIp(ip: string): string {
  const address = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;

  if (address.includes('.')) {
    const octets = address.split('.');
    if (octets.length !== 4) return address;
    return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
  }

  if (address.includes(':')) {
    // Expand `::` before truncating, or an abbreviated address loses the wrong
    // groups: `2001:db8::1` has four written groups but eight real ones.
    const [head = '', tail = ''] = address.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const groups = address.includes('::')
      ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
      : address.split(':');
    return groups.slice(0, 4).join(':') + '::';
  }

  return address;
}
