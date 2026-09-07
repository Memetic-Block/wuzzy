import { Body, Controller, HttpStatus, Inject, Options, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IndexesService } from '../indexes/indexes.service';
import { RateLimiter, anonymizeIp, clientIp } from './rate-limit';
import { EmptyQueryError, SearchService } from './search.service';
import { WEB_SEARCH_CONFIG, type WebSearchConfig } from './web-search.config';

interface WebSearchBody {
  readonly query?: unknown;
  readonly topK?: unknown;
  readonly offset?: unknown;
}

const MAX_TOP_K = 20;

/**
 * The free, rate-limited half of search: a box on the public site for people,
 * who cannot sign an x402 payment in a browser.
 *
 * Deliberately a separate route rather than a mode of `/search`. The metered
 * path's scenarios are a contract, and the way to keep them true is to leave
 * that handler alone. Two rules make this one safe to leave open:
 *
 * - It reads the global index and takes no `index` parameter at all. Access
 *   control rides x402, so an unmetered route that let a caller name an index
 *   would read a private one for free. There is no scoping to abuse because
 *   there is no scoping.
 * - It is off unless `WEB_SEARCH_ENABLED=true`, and a disabled instance answers
 *   404 rather than 403, so it does not advertise itself.
 *
 * The response is the same shape a paying agent gets, provenance included:
 * a result whose attestation a reader cannot click is not a receipt.
 */
@Controller('web-search')
export class WebSearchController {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly search: SearchService,
    private readonly indexes: IndexesService,
    @Inject(WEB_SEARCH_CONFIG) private readonly config: WebSearchConfig,
  ) {
    this.limiter = new RateLimiter(this.config.limit, this.config.windowMs);
  }

  @Options()
  preflight(@Req() request: Request, @Res() response: Response): void {
    this.applyCors(request, response);
    response.status(this.config.enabled ? HttpStatus.NO_CONTENT : HttpStatus.NOT_FOUND).end();
  }

  @Post()
  async post(
    @Body() body: WebSearchBody,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    this.applyCors(request, response);

    if (!this.config.enabled) {
      response.status(HttpStatus.NOT_FOUND).json({ error: 'Not Found' });
      return;
    }

    const key = anonymizeIp(
      clientIp(request.header('x-forwarded-for'), request.ip, this.config.proxyHops),
    );
    const verdict = this.limiter.check(key);
    if (!verdict.allowed) {
      response.setHeader('Retry-After', String(verdict.retryAfter));
      response
        .status(HttpStatus.TOO_MANY_REQUESTS)
        .json({ error: 'rate limit exceeded, try again shortly' });
      return;
    }

    const index = await this.indexes.resolve(null);
    const query = typeof body?.query === 'string' ? body.query : '';

    let page;
    try {
      page = await this.search.search(query, {
        topK: clamp(body?.topK, 10, 1, MAX_TOP_K),
        offset: clamp(body?.offset, 0, 0, Number.MAX_SAFE_INTEGER),
        scope: { indexId: index.id },
      });
    } catch (error) {
      if (error instanceof EmptyQueryError) {
        response.status(HttpStatus.BAD_REQUEST).json({ error: 'query must not be blank' });
        return;
      }
      throw error;
    }

    // Safe to share: the same query returns the same page for everyone, since
    // this route is unscoped and unauthenticated. Short, because the corpus
    // moves whenever a crawl lands.
    response.setHeader('Cache-Control', `public, max-age=${this.config.cacheSeconds}`);
    response.status(HttpStatus.OK).json({
      query,
      index: index.slug,
      offset: page.offset,
      topK: page.topK,
      total: page.total,
      exhaustive: page.exhaustive,
      hasMore: page.hasMore,
      results: page.results,
    });
  }

  /**
   * Echoes back only an origin on the list. `Vary` is not optional here: a
   * shared cache that ignored it would hand one origin's allow header to
   * another, which is the whole point of the check.
   */
  private applyCors(request: Request, response: Response): void {
    const origin = request.header('origin');
    response.setHeader('Vary', 'Origin');
    if (origin && this.config.origins.includes(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'content-type');
      response.setHeader('Access-Control-Max-Age', '86400');
    }
  }
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const requested = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(requested) || requested < min) return fallback;
  return Math.min(Math.floor(requested), max);
}
