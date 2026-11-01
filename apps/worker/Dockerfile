# Build from the repo root:  docker build -f apps/worker/Dockerfile -t grc-worker .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter "@grc/worker..."
COPY packages/core packages/core
COPY apps/worker apps/worker
RUN pnpm --filter @grc/worker build

FROM base AS runtime
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod --filter "@grc/worker..."
COPY --from=build /repo/apps/worker/dist apps/worker/dist
WORKDIR /repo/apps/worker
USER node
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
