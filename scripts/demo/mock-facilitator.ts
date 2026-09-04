/**
 * A local x402 facilitator that approves every well-formed payment, so the
 * 402 -> pay -> settle loop can be demonstrated without mainnet or funds.
 *
 *   bun scripts/demo/mock-facilitator.ts
 *   X402_FACILITATOR_URL=http://127.0.0.1:39600 bun apps/backend/src/main.ts
 *
 * NOTHING IS SETTLED. It returns a fabricated transaction hash. The real
 * mainnet settlement is the @mainnet @manual scenario in
 * contracts/payment.feature, and a human runs it.
 */
const PORT = Number(process.env.MOCK_FACILITATOR_PORT ?? 39600);
const PAYER = '0x1111111111111111111111111111111111111111';

Bun.serve({
  port: PORT,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = (await request.json().catch(() => ({}))) as {
      paymentRequirements?: { network?: string };
    };

    if (path === '/verify') {
      return Response.json({ isValid: true, payer: PAYER });
    }
    if (path === '/settle') {
      return Response.json({
        success: true,
        transaction: `0x${'d'.repeat(64)}`,
        network: body?.paymentRequirements?.network ?? 'base-sepolia',
        payer: PAYER,
      });
    }
    if (path === '/supported') {
      return Response.json({ kinds: [{ scheme: 'exact', network: 'base-sepolia' }] });
    }
    return new Response('{}', { status: 404 });
  },
});

console.log(`mock x402 facilitator on http://127.0.0.1:${PORT}  (settles NOTHING)`);

// Keeps this file a module, so its top-level names stay out of the global scope.
export {};
