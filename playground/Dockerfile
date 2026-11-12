# An image of the playground app, to show the health check under Docker.
# Build it from the repository root:
#
#     docker build -f playground/Dockerfile -t layerbase-playground .

FROM node:22-alpine AS build

RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# No postinstall yet: `nuxt prepare` needs the source, which comes next.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm rebuild && pnpm build

# ---------------------------------------------------------------------------

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3000
ENV NUXT_DATABASE_PATH=/data/playground.sqlite
ENV NUXT_LAYERBASE_MIGRATIONS_FOLDER=/app/drizzle
WORKDIR /app

# Nitro puts each runtime dependency into .output, so nothing else is needed
# except the migrations, which are applied when the server starts.
COPY --from=build /repo/playground/.output ./.output
COPY --from=build /repo/playground/drizzle ./drizzle

RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]
USER node

EXPOSE 3000

# Node's own `fetch`, so the image needs no curl. The port comes from $PORT. The
# start period leaves time for the migrations: a failure in that time is not counted.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
