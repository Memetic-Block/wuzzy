# Build from the repository root:
#   docker build -f apps/admin/Dockerfile .

# Alpine build stage: nothing here needs glibc, and the layer is not shipped
# anyway since the runtime stage is nginx.
FROM docker.io/oven/bun:1-alpine AS build
WORKDIR /app

# Workspace-aware install (dev deps included — Tailwind runs at build time).
COPY package.json bun.lock ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/admin/package.json ./apps/admin/
COPY packages/static-site/package.json ./packages/static-site/
RUN bun install --frozen-lockfile --linker=hoisted

COPY tsconfig.json tsconfig.base.json ./
COPY packages/static-site ./packages/static-site
COPY apps/admin ./apps/admin
RUN bun apps/admin/build.ts

FROM docker.io/library/nginx:1-alpine
# nginx.conf is an envsubst template; ${BACKEND_ORIGIN} is filled in at startup.
# The entrypoint renders /etc/nginx/templates/*.template into the output dir below.
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx
# Export NGINX_LOCAL_RESOLVERS (from resolv.conf) so the template's resolver works.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
ENV BACKEND_ORIGIN=http://backend:3000
COPY apps/admin/nginx.conf /etc/nginx/templates/nginx.conf.template
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
