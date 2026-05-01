# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=20-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY apps/mcp/package.json apps/mcp/
COPY packages/framework/package.json packages/framework/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM node:${NODE_VERSION} AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY --from=deps /app /app
COPY . .
# NEXT_PUBLIC_* vars are baked into the client bundle at Next.js build time.
# Pass --build-arg NEXT_PUBLIC_TENANT_ID=<uuid> (or set in docker-compose build.args).
ARG NEXT_PUBLIC_TENANT_ID=""
ENV NEXT_PUBLIC_TENANT_ID=${NEXT_PUBLIC_TENANT_ID}
RUN pnpm build

FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001

RUN addgroup -S lsds && adduser -S lsds -G lsds

# API service files
COPY --from=build --chown=lsds:lsds /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=lsds:lsds /app/apps/api/migrations ./apps/api/migrations
COPY --from=build --chown=lsds:lsds /app/node_modules ./node_modules
COPY --from=build --chown=lsds:lsds /app/packages ./packages
COPY --from=build --chown=lsds:lsds /app/package.json ./package.json
COPY --from=build --chown=lsds:lsds /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build --chown=lsds:lsds /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=lsds:lsds /app/apps/api/package.json ./apps/api/package.json

# Web service files (Next.js standalone)
# In pnpm monorepo mode, Next.js places server.js at standalone/apps/web/server.js
# Static assets must sit next to server.js for the standalone server to serve them.
COPY --from=build --chown=lsds:lsds /app/apps/web/.next/standalone ./apps/web/.next/standalone
COPY --from=build --chown=lsds:lsds /app/apps/web/.next/static ./apps/web/.next/standalone/apps/web/.next/static
COPY --from=build --chown=lsds:lsds /app/apps/web/public ./apps/web/.next/standalone/apps/web/public

# CLI tool (diagnostics sidecar — LSDS-152)
COPY --from=build --chown=lsds:lsds /app/apps/cli/dist ./apps/cli/dist
COPY --from=build --chown=lsds:lsds /app/apps/cli/package.json ./apps/cli/package.json
COPY --from=build --chown=lsds:lsds /app/apps/cli/node_modules ./apps/cli/node_modules

USER lsds

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "apps/api/dist/index.js"]
