# syntax=docker/dockerfile:1.7

FROM node:22.22.3-bookworm-slim AS base

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

FROM base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.cache/node/corepack \
    HUSKY=0 corepack pnpm install --frozen-lockfile

COPY . .
RUN HUSKY=0 corepack pnpm build

FROM base AS production-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Omit the repository's prepare hook because Husky is a dev dependency; keep
# dependency lifecycle scripts needed to build native production packages.
RUN node -e "const fs=require('node:fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); delete p.scripts?.prepare; fs.writeFileSync('package.json', JSON.stringify(p));"
RUN --mount=type=cache,target=/root/.cache/node/corepack \
    HUSKY=0 corepack pnpm install --prod --frozen-lockfile

FROM base AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json

USER node
EXPOSE 8080
CMD ["node", "dist/main"]