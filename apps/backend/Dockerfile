# Build from the repository root:
#   podman build -f apps/backend/Dockerfile .

# ---- deps -------------------------------------------------------------------
# Alpine rather than the Debian-based default: the runtime deps are pure JS or
# ship musl builds, and it saves ~130 MB.
FROM docker.io/oven/bun:1-alpine AS deps
WORKDIR /app

# Workspace-aware install: every workspace package.json must be present.
COPY package.json bun.lock ./
# Every workspace manifest has to be present for a workspace-aware install,
# including ones this image does not run: bun resolves the whole graph.
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/admin/package.json ./apps/admin/
COPY packages/static-site/package.json ./packages/static-site/
# Hoisted rather than bun's default isolated layout. Isolated puts every package
# in a content-addressed .bun store and makes node_modules/<name> a symlink into
# it, so deleting a top-level entry frees nothing. Hoisted gives real
# directories, which is what makes the prune below actually remove bytes.
RUN bun install --frozen-lockfile --production --linker=hoisted

# Two dependencies over-declare what they need at runtime, and between them they
# are more than a third of the image:
#   x402    -> wagmi, a browser wallet-connection stack (@reown, @walletconnect,
#              porto, @base-org). The server decodes and verifies payments; it
#              never connects a wallet.
#   eas-sdk -> eas-contracts -> hardhat and solc, a build toolchain pulled in for
#              contract ABIs that ship as JSON alongside it.
# Nothing the image imports reaches either tree. @metamask deliberately stays:
# most of it is wallet code, but @openzeppelin/merkle-tree needs abi-utils, and
# the smoke stage below catches exactly that class of mistake.
RUN rm -rf \
      node_modules/wagmi \
      node_modules/@reown \
      node_modules/@walletconnect \
      node_modules/porto \
      node_modules/@base-org \
      node_modules/@nomicfoundation \
      node_modules/solc \
    && echo "pruned unreachable wallet and build-tool trees"

# ---- smoke ------------------------------------------------------------------
# Proves the pruned tree still loads every entry point the image exposes, so a
# prune that removed something needed fails the build rather than the deploy.
# The runtime stage takes node_modules from here rather than from `deps`
# specifically so this stage cannot be skipped: an unreferenced stage is pruned
# by buildkit, which would silently disarm the check in CI.
FROM deps AS smoke
COPY tsconfig.json tsconfig.base.json ./
COPY apps/backend ./apps/backend
RUN bun -e "\
  await import('./apps/backend/src/app.module.ts'); \
  await import('./apps/backend/src/cli/wuzzy.ts'); \
  const c = await import('./apps/backend/src/canonicalize/v1/index.ts'); \
  const r = c.canonicalize({ source: '<html><head><title>T</title></head><body><article><h1>T</h1><p>' + 'Canonicalization has to work in the shipped image, not just in CI. '.repeat(6) + '</p></article></body></html>', url: 'https://example.com/t' }); \
  if (r.skipped || !/^[0-9a-f]{64}$/.test(r.contentHash)) throw new Error('canonicalizer smoke failed'); \
  const p = await import('./apps/backend/src/payment/payment.service.ts'); \
  const svc = new p.PaymentService({ enabled: true, payTo: '0x0000000000000000000000000000000000000001', network: 'base', price: '\$0.01', facilitatorUrl: 'http://127.0.0.1:1', description: 'smoke' }); \
  const out = await svc.authorize(undefined, 'https://example.com/search'); \
  if (out.kind !== 'rejected' || out.rejection.status !== 402) throw new Error('x402 smoke failed'); \
  const a = await import('./apps/backend/src/attest/schema.ts'); \
  if (!a.schemaCarriesNoContent()) throw new Error('attestation schema smoke failed'); \
  a.encodeAttestation({ url: 'https://example.com/t', protocol: 'wuzzy/crawl', protocolVersion: 1, contentHash: 'b'.repeat(64), rawHash: 'a'.repeat(64), fetchedAt: new Date() }); \
  console.log('smoke ok'); \
"

# ---- runtime ----------------------------------------------------------------
FROM docker.io/oven/bun:1-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=smoke /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
# The curated crawl seeds ship with the image so `wuzzy crawl` needs no arguments.
COPY seeds.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/backend ./apps/backend

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT??3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["bun", "apps/backend/src/main.ts"]
