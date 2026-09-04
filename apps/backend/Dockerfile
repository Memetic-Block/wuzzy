# Build from the repository root:
#   docker build -f apps/backend/Dockerfile .

FROM docker.io/oven/bun:1
WORKDIR /app
ENV NODE_ENV=production

# Workspace-aware install: every workspace package.json must be present.
COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
RUN bun install --frozen-lockfile --production

COPY tsconfig.json tsconfig.base.json ./
COPY apps/backend ./apps/backend

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT??3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["bun", "apps/backend/src/main.ts"]
