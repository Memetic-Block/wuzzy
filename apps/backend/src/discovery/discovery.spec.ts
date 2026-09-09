import { describe, expect } from 'bun:test';
import { scenario } from '../testing/scenario';
import { buildIndexesConfig } from '../indexes/index.config';
import { buildPaymentConfig } from '../payment/payment.config';
import { PaymentService } from '../payment/payment.service';
import { buildDiscoveryConfig } from './discovery.config';
import { LlmsController } from './llms.controller';

/** A request the controller can read an origin off, as express would give it. */
const request = (origin = 'https://api.wuzzy.io') => {
  const url = new URL(origin);
  return {
    protocol: url.protocol.replace(':', ''),
    path: '/llms.txt',
    header: () => undefined,
    get: () => url.host,
  } as unknown as Parameters<LlmsController['llms']>[0];
};

const metered = (env: Record<string, string | undefined> = {}) =>
  new LlmsController(
    new PaymentService(
      buildPaymentConfig({
        X402_ENABLED: 'true',
        X402_PAY_TO: '0x0Deb462437ab46F703fcd15F9cf9c9Ea6472EAcB',
        X402_NETWORK: 'base',
        X402_PRICE: '$0.01',
        X402_FACILITATOR_URL: 'http://127.0.0.1:39601',
        ...env,
      }),
    ),
    buildIndexesConfig({ WUZZY_INDEX_PRICE_PER_PAGE: '$0.02' }),
    buildDiscoveryConfig({}),
  );

describe('llms.txt', () => {
  scenario('an agent learns the endpoints without being told about them', async () => {
    const body = await metered().llms(request());

    // Named at this deployment's own origin, so a stage build documents itself
    // rather than pointing a reader at production.
    expect(body).toContain('POST https://api.wuzzy.io/search');
    expect(body).toContain('POST https://api.wuzzy.io/indexes');
    expect(body).toContain('GET https://api.wuzzy.io/indexes/:reference');
  });

  scenario('the published prices are the ones the meter quotes', async () => {
    const body = await metered({ X402_PRICE: '$0.005' }).llms(request());

    // Read off the meter by asking it for a quote, not restated. A price typed
    // into this file is a price that goes stale the day the meter changes.
    expect(body).toContain('$0.0050');
    expect(body).toContain('$0.02');
    expect(body).not.toContain('$0.01 ');
  });

  scenario('the payment handshake is described where a payer will look', async () => {
    const body = await metered().llms(request());

    expect(body).toContain('HTTP 402');
    expect(body).toContain('X-PAYMENT');
    expect(body).toContain('Network: base');
    // USDC on Base, as the meter resolves it from the network.
    expect(body).toContain('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(body).toContain('Pay to: 0x0Deb462437ab46F703fcd15F9cf9c9Ea6472EAcB');
  });

  scenario('a machine can find a human', async () => {
    const body = await metered().llms(request());

    // In plain text. The site footer encodes its address against scrapers,
    // which also hides it from every reader this file is written for.
    expect(body).toContain('Contact: build@wuzzy.io');
    expect(body).not.toContain('email-protection');
  });
});
