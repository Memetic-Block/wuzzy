import { Body, Controller, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PaymentService } from '../payment/payment.service';
import { EmptyQueryError, SearchService } from './search.service';

interface SearchBody {
  readonly query?: unknown;
  readonly topK?: unknown;
}

const MAX_TOP_K = 50;

@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly payment: PaymentService,
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
    const resourceUrl = `${request.protocol}://${request.get('host') ?? 'localhost'}${request.path}`;
    const outcome = await this.payment.authorize(request.header('X-PAYMENT'), resourceUrl);

    if (outcome.kind === 'rejected') {
      response.status(outcome.rejection.status).json(outcome.rejection.body);
      return;
    }

    const query = typeof body?.query === 'string' ? body.query : '';
    const topK = clampTopK(body?.topK);

    let results;
    try {
      results = await this.search.search(query, topK);
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

    response.status(HttpStatus.OK).json({ query, results });
  }
}

function clampTopK(value: unknown): number {
  const requested = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(requested) || requested < 1) return 10;
  return Math.min(Math.floor(requested), MAX_TOP_K);
}
