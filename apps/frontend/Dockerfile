# Build from the repository root:
#   docker build -f apps/frontend/Dockerfile .

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
COPY apps/frontend ./apps/frontend

# src/site.config.ts is read while the pages are rendered, so these are build
# args rather than runtime environment: the values are baked into the HTML and
# changing one means rebuilding the image. Docker exposes an ARG to RUN as an
# environment variable, which is how the build below sees them.
#
# The two that do not exist yet render as a stated "published at cutover" note
# instead of a dead link, so the page is complete without them.
ARG SITE_ORIGIN
ARG API_ORIGIN
ARG X402_PRICE
ARG X402_NETWORK
ARG X402_PAY_TO
ARG EAS_SCHEMA_URL
ARG BAZAAR_URL
# The free human search box. Needs WEB_SEARCH_ENABLED on the backend to match.
ARG SEARCH_ENABLED
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
