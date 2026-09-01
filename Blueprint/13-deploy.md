# Deploy / hosting prep

Last updated: 2026-09-01.

Status 2026-08-18: friends-alpha **tunnel is OFF**. Stack stopped with
`docker compose -f docker-compose.yml -f docker-compose.tunnel.yml stop`
(volumes kept — no `-v`). Overlay still the way to bring a trycloudflare
URL back. Local compose at http://localhost:8080 is how to bring the
private stack back.

## What ships

- `pool` — Postgres Opponent Pool (pro drafts + player commits)
- `api` — NestJS (`Dockerfile`), SQLite on a volume, `GET /health`
- `web` — static Vite build behind nginx (`Dockerfile.client`), proxies `/api/*`
  to the API **without** the `/api` prefix (matches local Vite rewrite)

Local `npm start` remains `ts-node` for development. Production entry is
`npm run start:prod --workspace server` → `node dist/main.js`.

## Quick path (Docker Compose)

```bash
cp .env.example .env   # optional; compose sets DATABASE_URL and POOL_DATABASE_URL
docker compose up --build
```

Open http://localhost:8080 — nginx serves the SPA and proxies API calls.

First boot:

1. waits for Postgres health;
2. `prisma migrate deploy` on SQLite;
3. seeds heroes + pro matches from `server/data/*` if `Hero` count is 0
   (no OpenDota refetch);
4. migrates the Opponent Pool and seeds pro drafts from that same snapshot
   if the pool is empty.

Health checks:

- API: `GET http://localhost:8080/api/health` (via nginx) or hit the api
  container on `/health`
- Response shape: `{ status, sqlite, pool }` where `pool` is `ok`,
  `disabled`, or `error`. HTTP 503 only if SQLite is down; a dead pool is
  `degraded` + 200 so Compose still considers the API healthy
- Compose healthcheck on the API image probes `/health` (start period is
  120s — first-boot pool seed of ~2374 pro drafts is slow; nonempty pools
  also upsert the 304-row `legacy-player-pool.json` snapshot. A new
  `pro-matches.json` / `heroes.json` does **not** land in an existing
  volume until you `docker compose exec api` run `node dist/seed.js`
  and `npx ts-node --transpile-only scripts/seed-opponent-pool.ts`)

Request limits (launch hardening):

- JSON bodies capped at 64kb
- Write endpoints (non-GET except `/health`) limited to 60 req/min per
  owner token (or IP if the header is missing). Disabled when
  `NODE_ENV=test`

## Without Docker

1. `npm ci`
2. Set `DATABASE_URL` (SQLite file path)
3. Provision Postgres and set `POOL_DATABASE_URL` (Battle Mode needs it)
4. `npm run build`
5. `npm run prisma:migrate:deploy --workspace server`
6. `npm run pool:migrate:deploy --workspace server`
7. `npm run seed --workspace server` (once, from existing snapshots)
8. `npm run seed-opponent-pool --workspace server`
9. `NODE_ENV=production npm run start:prod --workspace server`
10. Serve `client/dist` with any static host; reverse-proxy `/api` → Nest with
    path strip, same as nginx.conf

`npm start` without `POOL_DATABASE_URL` still runs Draft / Evaluation /
History. Battle pulls, pool commit, and the pool half of the leaderboard
return 503 until the pool URL is set.

## Env knobs

See `.env.example`. Important:

- `CORS_ORIGIN` — leave empty behind same-origin nginx; set allowlist if SPA
  and API are on different hosts
- `POOL_DATABASE_URL` — required for the advertised Battle core loop.
  Compose sets it to the `pool` service. Empty disables pool features.
- `TELEMETRY_READ_TOKEN` — read `GET /api/telemetry/funnel`. Unset = 404.
  Events still ingest on `POST /api/telemetry`.
- `CLOUDFLARE_TUNNEL_TOKEN` — named tunnel only (`--profile named`). Quick
  tunnel for friends-alpha does not need it.
- Do not point production at `database/dev.db` from a laptop path

## SQLite backup and restore

The API volume (`dota-draft-data`) holds `prod.db`. Stop writes, copy the
file, start again. Restore is the reverse: stop the API, replace the file,
start.

```bash
# backup (API can stay up; SQLite is one file + optional WAL)
docker compose cp api:/data/prod.db ./backup-prod.db
# if the container is using WAL, copy those too
docker compose exec api sh -c 'ls -l /data'

# restore
docker compose stop api
docker compose cp ./backup-prod.db api:/data/prod.db
docker compose start api
```

Postgres Opponent Pool is a normal `pg_dump` / `pg_restore` of the `pool`
volume. Player commits are keyed by `sourceDraftId` (unique); restoring an
older pool dump will not duplicate those rows on the next commit.

## Friends-alpha this week (2 people, laptop)

Playtest happened. Tunnel is **currently OFF** (2026-08-18). Overlay and
compose files stay. No public launch. No domain, no VPS, no inbound
80/443. Keep the local Docker Desktop stack at http://localhost:8080 and
share a **Cloudflare quick tunnel** so two friends get a temporary
`https://*.trycloudflare.com` URL. TLS terminates at the Cloudflare
edge; `cloudflared` dials out.

`:8080` is bound to loopback only (`127.0.0.1:8080:80`). The laptop does
not advertise LAN:8080. Friends never hit that port — they hit the
trycloudflare URL.

The URL **dies** on tunnel restart, `docker compose down`, or laptop sleep.
That is fine for a scheduled playtest. Keep the lid open. Do not treat this
as a product URL.

Do **not** buy a domain this week. Do **not** rent a VPS this week.

### Nick runs (stack already healthy at :8080)

```bash
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up tunnel
```

If the stack is not up yet:

```bash
docker compose up -d --build
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up tunnel
```

Leave that in the foreground. Copy the `https://*.trycloudflare.com` line
from the logs. Send it to two friends. Check
`https://<that-host>/api/health` yourself first.

Host-side equivalent if `cloudflared` is already on PATH (same URL class,
still no token):

```bash
cloudflared tunnel --url http://127.0.0.1:8080
```

Prefer the compose overlay: no extra install, origin is `http://web:80` on
the compose network.

ngrok is an optional footnote if Cloudflare is blocked for a tester. Not
the primary path. Do not add a second nginx.

Funnel dump still uses the local token against the tunneled host:

```bash
curl -H "X-Telemetry-Read-Token: $TELEMETRY_READ_TOKEN" https://<trycloudflare-host>/api/telemetry/funnel
```

## Later: stable URL / more testers (not this week)

When you actually want a hostname that survives sleep and 5–15 people on a
box: cheap VPS (2 vCPU / 2 GB, Docker) + **named** Cloudflare Tunnel + a
domain in a Cloudflare zone. Same compose, two named volumes. Do not split
onto Fly/Railway.

1. Domain in Cloudflare (reuse one you have, or buy then). Apex or
   `draft.` — branding does not matter.
2. Zero Trust → Networks → Tunnels → Create (Docker). Paste the token into
   gitignored `.env` as `CLOUDFLARE_TUNNEL_TOKEN`. Public hostname →
   service **`http://web:80`**. Cloudflare CNAME to
   `<tunnel-id>.cfargotunnel.com` (proxied). No A record to the VPS.
3. On the VPS:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.tunnel.yml --profile named up -d --build
   ```

4. `https://<domain>/api/health`, then invite.

If testers are mostly on RU ISPs and Cloudflare is flaky, fallback is the
same VPS with an A record + Caddy/Let's Encrypt in front of
`127.0.0.1:8080`. That is a second proxy — don't start there.

## Pre-launch checklist (2026-09-01)

Use this before sending a link outside localhost.

### Product smoke (local compose or dev)

1. `docker compose up --build` → http://localhost:8080/api/health returns
   `{ status: "ok", sqlite: "ok", pool: "ok" }`.
2. Battle: draft → roles → eval → fight → history row appears.
3. Challenge: paste `dd1…` code → fight resolves; coin-flip path shows no
   `battle-story`.
4. TI Run: one win path, one loss path, GF win (champion) and GF loss
   (eliminated). Automated: `e2e/ti-run.spec.ts` + `server/src/ti-run/ti-bracket.spec.ts`.
5. Set `TELEMETRY_READ_TOKEN` in `.env`; after ~10 sessions verify
   `GET /api/telemetry/funnel` with `X-Telemetry-Read-Token`.

### URL strategy — pick one

| Mode | Cost | When |
|------|------|------|
| **Quick tunnel** | $0 | Scheduled playtest; URL dies on laptop sleep |
| **VPS + named tunnel** | ~$6–15/mo + domain | Public soft launch; stable hostname |

Quick tunnel (friends-alpha):

```bash
docker compose up -d --build
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up tunnel
```

Named tunnel (stable URL): see **Later: stable URL** below; paste
`CLOUDFLARE_TUNNEL_TOKEN` into gitignored `.env`.

### Off-box backup runbook

**SQLite** (`dota-draft-data` volume — drafts, history, telemetry):

```bash
# Weekly (or before any deploy that touches schema)
docker compose cp api:/data/prod.db ./backups/prod-$(date +%F).db
```

**Postgres pool** (`dota-draft-pool` volume — opponent commits):

```bash
docker compose exec -T pool pg_dump -U dota opponent_pool > ./backups/pool-$(date +%F).sql
```

Store `./backups/` off the VPS (S3, second disk, gitignored local copy).
Restore commands are in **SQLite backup and restore** above and standard
`pg_restore` for the pool dump.

One-liner from repo root (compose must be up):

```bash
npm run backup:compose
# or: bash scripts/backup-compose-volumes.sh
```

Telemetry funnel dump after launch:

```bash
TELEMETRY_READ_TOKEN=... bash scripts/telemetry-funnel.sh https://your-host
```

**After snapshot bump** (`pro-matches.json` / `heroes.json` changed):

```bash
docker compose exec api node dist/seed.js
docker compose exec api npx ts-node --transpile-only scripts/seed-opponent-pool.ts
```

Existing volumes do **not** auto-reseed pro rows on image rebuild alone.

## Still manual after this prep

- Off-box backup schedule for the SQLite volume **and** the Postgres pool
  volume — commands are in this file; you still pick a destination
- Named tunnel / domain / VPS — only when a stable URL is actually needed
  (cannot be done from this repo)

## Non-goals of this pass

- Accounts / auth
- Switching primary DB to Postgres (SQLite is intentional for MVP)
- Mass lint/format cleanup of research scripts
