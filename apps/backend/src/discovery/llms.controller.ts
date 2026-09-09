import { Controller, Get, Header, Inject, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DISCOVERY_CONFIG, type DiscoveryConfig } from './discovery.config';
import { INDEXES_CONFIG, type IndexesConfig } from '../indexes/index.config';
import { PaymentService, resourceUrl } from '../payment/payment.service';

/**
 * What this API is, for a reader that is not a browser.
 *
 * The site and the docs render these facts for people. An agent that arrives
 * at the API with no prior knowledge has neither, and asking it to parse
 * marketing markup to find a price is the failure this product exists to
 * argue against.
 *
 * Everything here is derived rather than written down. The quote comes from
 * the meter by asking it for one, so the price advertised is the price a payer
 * is charged and the two cannot drift; the origin comes from the request, so a
 * stage deploy documents itself rather than pointing at production.
 */
@Controller('llms.txt')
export class LlmsController {
  constructor(
    private readonly payment: PaymentService,
    @Inject(INDEXES_CONFIG) private readonly indexes: IndexesConfig,
    @Inject(DISCOVERY_CONFIG) private readonly discovery: DiscoveryConfig,
  ) {}

  @Get()
  @Header('content-type', 'text/plain; charset=utf-8')
  // A file agents are meant to cache, and one that changes only when the
  // configuration does.
  @Header('cache-control', 'public, max-age=3600')
  async llms(@Req() request: Request): Promise<string> {
    const origin = new URL(resourceUrl(request)).origin;

    // Ask the meter what a search costs by making the request a payer makes
    // and reading the answer. Nothing here restates a price.
    const quote = await this.payment.authorize(undefined, `${origin}/search`);
    const accepted =
      quote.kind === 'rejected'
        ? ((quote.rejection.body as { accepts?: readonly Record<string, unknown>[] }).accepts?.[0] ??
          null)
        : null;

    const paying = accepted
      ? [
          `- An unpaid request answers HTTP 402 with x402 payment requirements. Sign one and retry with it in the X-PAYMENT header.`,
          `- A search costs ${usd(accepted.maxAmountRequired)} and a crawled page costs ${this.indexes.pricePerPage}.`,
          `- Network: ${String(accepted.network)}. Asset: ${String(accepted.asset)}. Pay to: ${String(accepted.payTo)}.`,
          `- No accounts and no API keys: a signed payment is the only credential.`,
          `- A request that fails is never charged for. Settlement happens after the handler produced a response.`,
        ]
      : [
          // Dev and fork stacks run the meter off on purpose. Saying so is
          // more useful than publishing a price nobody will be asked for.
          `- The meter is disabled on this deployment. Requests are answered without payment.`,
        ];

    return [
      '# Wuzzy API',
      '',
      '> Provable, decentralized search. Every result carries an onchain receipt: what was',
      '> crawled, when, and proof nobody has rearranged it since.',
      '',
      '## Endpoints',
      '',
      `- POST ${origin}/search — one metered query, with provenance on every result.`,
      `- POST ${origin}/indexes — commission an index over URLs you name.`,
      `- POST ${origin}/indexes/:reference/urls — add pages to an index you own.`,
      `- GET ${origin}/indexes — the public catalog of listed indexes.`,
      `- GET ${origin}/indexes/:reference — one index's status: pages, attestations, pending, failures.`,
      `- GET ${origin}/healthz — liveness.`,
      '',
      '## Paying',
      '',
      ...paying,
      '',
      '## Provenance',
      '',
      '- Every result carries a provenance block: protocol, protocolVersion, contentHash, rawHash, fetchedAt.',
      '- An attested result also carries attestationUid and attestationUrl, readable on Base without asking us.',
      '- The hashes are produced by a published procedure with conformance vectors, so a third party can reproduce them.',
      '',
      '## More',
      '',
      '- Integration docs, including the payment handshake: ' + this.discovery.docsUrl,
      '- Source, the canonicalizer included: ' + this.discovery.repoUrl,
      // Plain text on purpose. The site footer encodes its address against
      // scrapers, which hides it from the readers this file is written for.
      `- Contact: ${this.discovery.contact}`,
      '',
    ].join('\n');
  }
}

/** Atomic USDC back to the dollars the rest of the file speaks in. */
function usd(atomic: unknown): string {
  const micros = Number(atomic);
  if (!Number.isFinite(micros)) return 'an amount the 402 states';
  const dollars = micros / 1_000_000;
  return `$${dollars < 0.01 ? dollars.toFixed(4) : dollars.toFixed(2)}`;
}
