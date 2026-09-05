import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PaymentService, payerOf, type PaymentAcceptance } from '../payment/payment.service';
import {
  IndexesService,
  InvalidUrlError,
  InvalidWalletError,
  PageCapExceededError,
  UnknownIndexError,
} from './indexes.service';
import type { IndexReadPolicy, IndexVisibility } from '../database/index.entity';

interface CreateBody {
  readonly name?: unknown;
  readonly urls?: unknown;
  readonly visibility?: unknown;
  readonly readPolicy?: unknown;
  readonly allowlist?: unknown;
  /** Dev mode only: with the meter off there is no payer to own the index. */
  readonly owner?: unknown;
}

interface AppendBody {
  readonly urls?: unknown;
}

/**
 * Index lifecycle, metered the same way search is.
 *
 * Creation and appends are priced per page and quoted from the request body
 * alone, so the amount in the 402 is the amount the client signs for. The
 * ownership and allowlist checks run after the facilitator verifies the
 * payment and before settlement, so a rejected caller is never charged.
 */
@Controller('indexes')
export class IndexesController {
  constructor(
    private readonly indexes: IndexesService,
    private readonly payment: PaymentService,
  ) {}

  /** The public catalog. Unlisted indexes are absent from it entirely. */
  @Get()
  async list(): Promise<{ indexes: unknown[] }> {
    await this.indexes.ensureGlobalIndex();
    return { indexes: await this.indexes.catalog() };
  }

  @Get(':reference')
  async status(@Param('reference') reference: string, @Res() response: Response): Promise<void> {
    const index = await this.indexes.resolve(reference).catch(() => null);
    if (!index) {
      response.status(HttpStatus.NOT_FOUND).json({ error: `no such index: ${reference}` });
      return;
    }
    response.status(HttpStatus.OK).json(await this.indexes.status(index));
  }

  @Post()
  async create(
    @Body() body: CreateBody,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const urls = stringList(body?.urls);
    if (!urls) {
      response.status(HttpStatus.BAD_REQUEST).json({ error: 'urls must be a non-empty array' });
      return;
    }
    // Quoted before the meter sees the request, and only from the body, so the
    // 402's amount and the retry's signed amount cannot disagree.
    if (urls.length > this.indexes.pageCap) {
      response.status(HttpStatus.BAD_REQUEST).json({
        error: `this request covers ${urls.length} pages; the cap is ${this.indexes.pageCap}`,
        pageCap: this.indexes.pageCap,
        requested: urls.length,
      });
      return;
    }

    const outcome = await this.payment.authorize(header(request), resourceUrl(request), {
      price: this.indexes.priceForPages(urls.length),
      description: `Commission a Wuzzy index of ${urls.length} page(s)`,
    });
    if (outcome.kind === 'rejected') {
      response.status(outcome.rejection.status).json(outcome.rejection.body);
      return;
    }

    const owner = ownerFor(outcome.kind === 'accepted' ? outcome.accepted : null, body?.owner);
    if (!owner) {
      response
        .status(HttpStatus.BAD_REQUEST)
        .json({ error: 'owner is required when the meter is disabled' });
      return;
    }

    try {
      const created = await this.indexes.create({
        owner,
        name: typeof body?.name === 'string' ? body.name : undefined,
        urls,
        visibility: enumValue<IndexVisibility>(body?.visibility, ['listed', 'unlisted']),
        readPolicy: enumValue<IndexReadPolicy>(body?.readPolicy, ['open', 'allowlist']),
        allowlist: stringList(body?.allowlist) ?? [],
      });

      if (outcome.kind === 'accepted') {
        const settled = await this.payment.settle(outcome.accepted);
        if (settled) response.setHeader('X-PAYMENT-RESPONSE', settled);
      }
      response.status(HttpStatus.CREATED).json(await this.indexes.status(created));
    } catch (error) {
      respondToDomainError(error, response);
    }
  }

  @Post(':reference/urls')
  async append(
    @Param('reference') reference: string,
    @Body() body: AppendBody,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const index = await this.indexes.resolve(reference).catch(() => null);
    if (!index) {
      response.status(HttpStatus.NOT_FOUND).json({ error: `no such index: ${reference}` });
      return;
    }
    const urls = stringList(body?.urls);
    if (!urls) {
      response.status(HttpStatus.BAD_REQUEST).json({ error: 'urls must be a non-empty array' });
      return;
    }

    const outcome = await this.payment.authorize(header(request), resourceUrl(request), {
      price: this.indexes.priceForPages(urls.length),
      description: `Append ${urls.length} page(s) to a Wuzzy index`,
    });
    if (outcome.kind === 'rejected') {
      response.status(outcome.rejection.status).json(outcome.rejection.body);
      return;
    }

    // Between verification and settlement: a wallet that may not write here
    // learns so without being charged for finding out.
    const payer = outcome.kind === 'accepted' ? payerOf(outcome.accepted) : null;
    if (this.payment.enabled && !this.indexes.canWrite(index, payer)) {
      response.status(HttpStatus.FORBIDDEN).json({ error: 'only the index owner may append' });
      return;
    }

    try {
      const intake = await this.indexes.append(index, urls);
      if (outcome.kind === 'accepted') {
        const settled = await this.payment.settle(outcome.accepted);
        if (settled) response.setHeader('X-PAYMENT-RESPONSE', settled);
      }
      response.status(HttpStatus.OK).json({ ...(await this.indexes.status(index)), ...intake });
    } catch (error) {
      respondToDomainError(error, response);
    }
  }

  @Delete(':reference')
  async remove(
    @Param('reference') reference: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const index = await this.indexes.resolve(reference).catch(() => null);
    if (!index) {
      response.status(HttpStatus.NOT_FOUND).json({ error: `no such index: ${reference}` });
      return;
    }

    // Deletion is free, so there is nothing to settle and nothing to refund;
    // the payment is a signature proving who is asking.
    const outcome = await this.payment.authorize(header(request), resourceUrl(request));
    if (outcome.kind === 'rejected') {
      response.status(outcome.rejection.status).json(outcome.rejection.body);
      return;
    }
    const payer = outcome.kind === 'accepted' ? payerOf(outcome.accepted) : null;
    if (this.payment.enabled && !this.indexes.canWrite(index, payer)) {
      response.status(HttpStatus.FORBIDDEN).json({ error: 'only the index owner may delete it' });
      return;
    }

    await this.indexes.remove(index);
    response.status(HttpStatus.OK).json({ deleted: index.id });
  }
}

const header = (request: Request): string | undefined => request.header('X-PAYMENT');

const resourceUrl = (request: Request): string =>
  `${request.protocol}://${request.get('host') ?? 'localhost'}${request.path}`;

/**
 * The payer owns what they commissioned. With the meter off there is no payer,
 * so an owner has to be stated outright rather than invented.
 */
function ownerFor(accepted: PaymentAcceptance | null, declared: unknown): string | null {
  if (accepted) return payerOf(accepted);
  return typeof declared === 'string' && declared.trim() !== '' ? declared : null;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((item) => typeof item === 'string' && item.trim() !== '')) return null;
  return value as string[];
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

function respondToDomainError(error: unknown, response: Response): void {
  if (error instanceof PageCapExceededError) {
    response.status(HttpStatus.BAD_REQUEST).json({
      error: error.message,
      pageCap: error.cap,
      requested: error.requested,
    });
    return;
  }
  if (error instanceof InvalidUrlError || error instanceof InvalidWalletError) {
    response.status(HttpStatus.BAD_REQUEST).json({ error: error.message });
    return;
  }
  if (error instanceof UnknownIndexError) {
    response.status(HttpStatus.NOT_FOUND).json({ error: error.message });
    return;
  }
  throw error;
}
