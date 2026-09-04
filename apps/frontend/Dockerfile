# Build from the repository root:
#   docker build -f apps/frontend/Dockerfile .

FROM docker.io/oven/bun:1 AS build
WORKDIR /app

# Workspace-aware install (dev deps included — Tailwind runs at build time).
COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
RUN bun install --frozen-lockfile

COPY tsconfig.json tsconfig.base.json ./
COPY apps/frontend ./apps/frontend
RUN bun apps/frontend/build.ts

FROM docker.io/library/nginx:1-alpine
# nginx.conf is an envsubst template; ${BACKEND_ORIGIN} is filled in at startup.
# The entrypoint renders /etc/nginx/templates/*.template into the output dir below.
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx
# Export NGINX_LOCAL_RESOLVERS (from resolv.conf) so the template's resolver works.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
ENV BACKEND_ORIGIN=http://backend:3000
COPY apps/frontend/nginx.conf /etc/nginx/templates/nginx.conf.template
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
