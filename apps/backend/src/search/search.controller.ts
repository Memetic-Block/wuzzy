import { Body, Controller, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IndexesService, UnknownIndexError } from '../indexes/indexes.service';
import { PaymentService, payerOf } from '../payment/payment.service';
import { EmptyQueryError, SearchService } from './search.service';

interface SearchBody {
  readonly query?: unknown;
  readonly topK?: unknown;
  /** Documents to skip, for paging. */
  readonly offset?: unknown;
  /** Optional override, mostly for tuning: hybrid, vector or lexical. */
  readonly mode?: unknown;
  /** Index id or slug. Absent means the global index. */
  readonly index?: unknown;
}

const MAX_TOP_K = 50;

@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly payment: PaymentService,
    private readonly indexes: IndexesService,
  ) {}

  /**
   * Keyless and metered: no accounts, no API keys, payment is the only gate.
   * Settlement happens after results exist, so a query that fails is not
   * charged for.
   */
  @Post()
  async post(
    @Body() body: SearchBody,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const reference = typeof body?.index === 'string' ? body.index : null;
    let index;
    try {
      index = await this.indexes.resolve(reference);
    } catch (error) {
      if (!(error instanceof UnknownIndexError)) throw error;
      response.status(HttpStatus.NOT_FOUND).json({ error: error.message });
      return;
    }

    const resourceUrl = `${request.protocol}://${request.get('host') ?? 'localhost'}${request.path}`;
    const outcome = await this.payment.authorize(request.header('X-PAYMENT'), resourceUrl);

    if (outcome.kind === 'rejected') {
      response.status(outcome.rejection.status).json(outcome.rejection.body);
      return;
    }

    // The allowlist check sits between verification and settlement. A verified
    // payment is what proves control of the payer wallet, so it has to come
    // first; settling before checking would charge a wallet for a 403.
    const payer = outcome.kind === 'accepted' ? payerOf(outcome.accepted) : null;
    if (this.payment.enabled && !(await this.indexes.canRead(index, payer))) {
      response.status(HttpStatus.FORBIDDEN).json({ error: 'not permitted to read this index' });
      return;
    }

    const query = typeof body?.query === 'string' ? body.query : '';
    const topK = clampTopK(body?.topK);
    const offset = clampOffset(body?.offset);
    const mode = ['hybrid', 'vector', 'lexical'].includes(String(body?.mode))
      ? (String(body?.mode) as 'hybrid' | 'vector' | 'lexical')
      : undefined;

    let page;
    try {
      page = await this.search.search(query, { topK, offset, mode, scope: { indexId: index.id } });
    } catch (error) {
      if (error instanceof EmptyQueryError) {
        response.status(HttpStatus.BAD_REQUEST).json({ error: 'query must not be blank' });
        return;
      }
      throw error;
    }

    if (outcome.kind === 'accepted') {
      const header = await this.payment.settle(outcome.accepted);
      if (header) response.setHeader('X-PAYMENT-RESPONSE', header);
    }

    response.status(HttpStatus.OK).json({
      query,
      index: index.slug,
      offset: page.offset,
      topK: page.topK,
      total: page.total,
      // total is a floor when the arms were cut off at the retrieval ceiling,
      // so a client should render "200+" rather than claim a corpus-wide count.
      exhaustive: page.exhaustive,
      hasMore: page.hasMore,
      results: page.results,
    });
  }
}

function clampTopK(value: unknown): number {
  const requested = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(requested) || requested < 1) return 10;
  return Math.min(Math.floor(requested), MAX_TOP_K);
}

function clampOffset(value: unknown): number {
  const requested = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(requested) || requested < 0) return 0;
  return Math.floor(requested);
}
