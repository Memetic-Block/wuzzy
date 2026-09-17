Wuzzy x402 v1 plus v2 smoke on Base mainnet, 2026-09-17. Payer 0xe2F5810fB874f0C9E6377231f67015f2827d6F59. Three searches, 0.03 USDC total. No index writes.

Unpaid POST /search returns 402. The JSON body is protocol version 1: x402Version 1, network "base", maxAmountRequired "10000". The PAYMENT-REQUIRED header is protocol version 2 (base64 JSON): x402Version 2, network "eip155:8453", amount "10000". payTo and asset match in both: 0x0Deb462437ab46F703fcd15F9cf9c9Ea6472EAcB and USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913. Error string: X-PAYMENT or PAYMENT-SIGNATURE header is required.

Version 2 works. @x402/fetch 2.x with ExactEvmScheme on eip155:8453 returned HTTP 200 for a global search and for index memeticblock-com-smoke. Settlement is in PAYMENT-RESPONSE only, not X-PAYMENT-RESPONSE. Decoded network is eip155:8453. Ten results each. Onchain both times: 0.01 USDC from the payer to payTo. Global tx 0xa34f9e97e9bc49187571f8cf51154deb4d5b0dfac3eea928da9e56b527eeed62. Own-index tx 0xe0d3819ba22a5236bc7aaefb8bdd9b462e3fbeaf5b7aff7d83f81efcc0e7dbcc.

Version 1 still settles on the server, but a v1-only @x402/fetch 2.x client will not pay as documented. ExactEvmSchemeV1 with network "base" and x402Version 1 throws before a retry request: Failed to create payment payload: No client registered for x402 version: 2. The wrapper prefers PAYMENT-REQUIRED (v2), so a v1-only scheme has nothing to sign. Agents will think v1 is broken.

One retry: same v1 scheme after stripping PAYMENT-REQUIRED so the client reads the v1 JSON body. That returned HTTP 200. Settlement is in X-PAYMENT-RESPONSE only, not PAYMENT-RESPONSE. Decoded network is "base". Ten results. Onchain 0.01 USDC same route, tx 0x5783e36352d1ecf0a29c43d39633486240782c4bd7c0c2629b9b90f66088d1e4.

Header pairing now: v2 pays with PAYMENT-SIGNATURE and gets PAYMENT-RESPONSE with network eip155:8453. v1 pays with X-PAYMENT and gets X-PAYMENT-RESPONSE with network base.

Please document that dual 402, and that v1-only fetch 2.x against this 402 throws instead of signing v1 unless the client ignores PAYMENT-REQUIRED or registers both schemes. Empty-wallet and wrong-version still showed as invalid_payload on an earlier run; not retested today. Not tested this pass: v1 against a commissioned index, v2 commission/append, facilitator errors.
