import { createServer, type Server } from 'node:http';

export interface MockFacilitator {
  readonly url: string;
  /** Payments the facilitator was asked to verify, then to settle. */
  readonly verified: unknown[];
  readonly settled: unknown[];
  /** Flip to make verification fail the way an underfunded payment would. */
  valid: boolean;
  invalidReason: string;
  /** Clears the call log and restores defaults between scenarios. */
  reset(): void;
  close(): Promise<void>;
}

/**
 * Stands in for the x402 facilitator so the payment scenarios exercise the real
 * decode, match, verify and settle path without a funded key anywhere near the
 * test. Settlement against Base mainnet is @mainnet @manual and run by hand.
 */
export async function startMockFacilitator(): Promise<MockFacilitator> {
  const verified: unknown[] = [];
  const settled: unknown[] = [];
  const state = { valid: true, invalidReason: 'insufficient_funds' };

  const server: Server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      const body = raw === '' ? {} : JSON.parse(raw);
      const path = (request.url ?? '').split('?')[0];
      response.setHeader('content-type', 'application/json');

      if (path === '/verify') {
        verified.push(body);
        response.end(
          JSON.stringify(
            state.valid
              ? { isValid: true, payer: '0x1111111111111111111111111111111111111111' }
              : { isValid: false, invalidReason: state.invalidReason, payer: null },
          ),
        );
        return;
      }
      if (path === '/settle') {
        settled.push(body);
        response.end(
          JSON.stringify({
            success: true,
            transaction: `0x${'d'.repeat(64)}`,
            network: body?.paymentRequirements?.network ?? 'base',
            payer: '0x1111111111111111111111111111111111111111',
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end('{}');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port assigned');

  return {
    url: `http://127.0.0.1:${address.port}`,
    verified,
    settled,
    get valid() {
      return state.valid;
    },
    set valid(next: boolean) {
      state.valid = next;
    },
    get invalidReason() {
      return state.invalidReason;
    },
    set invalidReason(next: string) {
      state.invalidReason = next;
    },
    reset() {
      verified.length = 0;
      settled.length = 0;
      state.valid = true;
      state.invalidReason = 'insufficient_funds';
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
