# Deploy / hosting prep

Last updated: 2026-08-17.

## What ships

- `api` — NestJS (`Dockerfile`), SQLite on a volume, `GET /health`
- `web` — static Vite build behind nginx (`Dockerfile.client`), proxies `/api/*`
  to the API **without** the `/api` prefix (matches local Vite rewrite)

Local `npm start` remains `ts-node` for development. Production entry is
`npm run start:prod --workspace server` → `node dist/main.js`.

## Quick path (Docker Compose)

```bash
cp .env.example .env   # optional; compose sets DATABASE_URL for the container
docker compose up --build
```

Open http://localhost:8080 — nginx serves the SPA and proxies API calls.

First boot runs `prisma migrate deploy`, then seeds from `server/data/*` only
if `Hero` count is 0 (no OpenDota refetch).

Health checks:

- API: `GET http://localhost:8080/api/health` (via nginx) or hit the api
  container on `/health`
- Compose healthcheck on the API image probes `/health`

## Without Docker

1. `npm ci`
2. Set `DATABASE_URL` (SQLite file path)
3. `npm run build`
4. `npm run prisma:migrate:deploy --workspace server`
5. `npm run seed --workspace server` (once, from existing snapshots)
6. `NODE_ENV=production npm run start:prod --workspace server`
7. Serve `client/dist` with any static host; reverse-proxy `/api` → Nest with
   path strip, same as nginx.conf

## Env knobs

See `.env.example`. Important:

- `CORS_ORIGIN` — leave empty behind same-origin nginx; set allowlist if SPA
  and API are on different hosts
- `POOL_DATABASE_URL` — optional; empty is fine for MVP
- Do not point production at `database/dev.db` from a laptop path

## Still manual after this prep

- Choose a host (Fly / Railway / VPS / etc.) and point DNS
- TLS termination (Caddy, cloud LB, or platform certs)
- Backups for the SQLite volume
- Observability beyond local telemetry (`client/src/telemetry/`)

## Non-goals of this pass

- Accounts / auth
- Switching primary DB to Postgres (SQLite is intentional for MVP)
- Mass lint/format cleanup of research scripts
