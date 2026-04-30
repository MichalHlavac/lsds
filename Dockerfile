# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY apps ./apps
COPY packages ./packages
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM node:${NODE_VERSION} AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY --from=deps /app /app
COPY . .
RUN pnpm build
RUN pnpm prune --prod

FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

RUN addgroup -S lsds && adduser -S lsds -G lsds

COPY --from=build --chown=lsds:lsds /app/node_modules ./node_modules
COPY --from=build --chown=lsds:lsds /app/apps ./apps
COPY --from=build --chown=lsds:lsds /app/packages ./packages
COPY --from=build --chown=lsds:lsds /app/package.json ./package.json
COPY --from=build --chown=lsds:lsds /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

USER lsds

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "apps/api/dist/index.js"]
