# syntax=docker/dockerfile:1

# Production image: Nest API only. Static client is a separate stage/service
# (see docker-compose.yml + Blueprint/13-deploy.md). Vite keeps stripping /api
# in local dev; the reverse proxy must do the same in prod.

FROM node:20-bookworm-slim AS deps
# Prisma on bookworm-slim cannot detect libssl and silently generates
# debian-openssl-1.1.x engines; runtime then dies looking for 3.0.x.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci

FROM deps AS build
COPY shared shared
COPY server server
COPY tsconfig.base.json ./
RUN npm run build --workspace shared && npm run build --workspace server

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_URL=file:/data/prod.db

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/package-lock.json ./package-lock.json
COPY --from=deps /app/server/package.json ./server/package.json
COPY --from=deps /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared ./shared
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/server/prisma-pool ./server/prisma-pool
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/scripts/seed-opponent-pool.ts ./server/scripts/seed-opponent-pool.ts
COPY --from=build /app/server/tsconfig.json ./server/tsconfig.json
COPY --from=build /app/tsconfig.base.json ./tsconfig.base.json
COPY server/data ./server/data
COPY docker/server-entrypoint.sh /entrypoint.sh

# Workspace install leaves node_modules/shared as a symlink; flatten it so the
# runtime image does not depend on the build-context path.
RUN rm -rf node_modules/shared \
  && mkdir -p node_modules/shared \
  && cp shared/package.json node_modules/shared/package.json \
  && cp -R shared/dist node_modules/shared/dist \
  && chmod +x /entrypoint.sh \
  && mkdir -p /data \
  && sed -i 's/\r$//' /entrypoint.sh

# Do not COPY host `server/generated` — it is gitignored and often a Windows
# or OpenSSL 1.1 engine. Generate inside bookworm (OpenSSL 3) instead.
WORKDIR /app/server
RUN npx prisma generate \
  && npx prisma generate --schema=prisma-pool/schema.prisma
WORKDIR /app

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
