# Operational Notes

Environment/tooling gotchas discovered while building this project (Windows + Git Bash + PowerShell + this agent's tool sandbox). Not project rules — just things that will waste time again if rediscovered from scratch.

---

## Background processes must use the tool's own `run_in_background`, not `nohup ... &`

Wrapping a long-running command in `nohup cmd > log 2>&1 &` inside a single Bash tool call does NOT survive past that tool call returning in this environment — the child process gets killed along with it, `nohup` notwithstanding. To run something long (dev servers, the OpenDota fetch scripts) in the background, pass the command directly with `run_in_background: true` on the Bash/PowerShell tool call itself — no `&`, no `nohup`.

Symptom if you get this wrong: the process appears to start, a "completed" notification fires almost immediately, and the log file stops after 1-2 lines with no error.

---

## Prisma Client generation fails with EPERM on Windows if a server is running

`npx prisma generate` / `migrate dev` can fail with:

```
EPERM: operation not permitted, rename '...query_engine-windows.dll.node.tmp...' -> '...query_engine-windows.dll.node'
```

Cause: any running Node process that has `@prisma/client` loaded (typically the NestJS server) holds the query engine DLL open, and Windows won't let it be replaced. Fix: stop whatever is listening on the server port first, e.g.:

```powershell
Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -Property OwningProcess | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
```

then retry `prisma generate`.

---

## Killing processes: only narrowly-scoped, justified kills are allowed

Stopping a process by port (`Get-NetTCPConnection -LocalPort X -State Listen | Stop-Process`) is fine and has been used repeatedly without issue. Killing PIDs discovered via a broad `Get-CimInstance Win32_Process` scan across all `node.exe` (or similar) in the same command as the scan gets denied by the safety classifier as "interfering with workloads" — it can't tell a leftover dev server from an unrelated process. If you genuinely need to clean up a specific orphaned/duplicate process found via inspection, kill it in its own precisely-scoped call with clear justification, not bundled with the discovery query.

---

## Git Bash `/tmp` and native Windows Node's `/tmp` are different filesystems

Writing a file via the Bash tool to `/tmp/foo.json` and then reading it from `node -e "..."` (native Windows node.exe) with the same path will fail with `ENOENT` — Git Bash's `/tmp` doesn't map to `C:\tmp`. Use the session scratchpad directory (a real Windows path under `AppData\Local\Temp\claude\...`) for anything that needs to be written by one and read by the other.

---

## OpenDota Explorer SQL — what's fast vs. what times out

`https://api.opendota.com/api/explorer?sql=...` is a shared, rate-limited Postgres read replica.

- **Fast (~0.5-3s):** queries anchored on `player_matches.hero_id = X` (optionally plus `match_id > threshold`), including self-joins for ally synergy. Always filter on `hero_id` first.
- **Times out (~15-20s, `"Query read timeout"`):** any query without a selective anchor — e.g. `MAX(match_id)` over the whole `public_matches` table, `GROUP BY` over an unfiltered or loosely-filtered range, `ORDER BY` on a non-indexed column across many rows.
- **`public_matches.avg_rank_tier >= 80` (Immortal) returns ~zero rows.** High-MMR players' matches appear largely absent from the public sample, most likely because top-bracket players commonly keep match history private. Don't chase true Immortal-only data here — use `heroStats`' rank-bracket buckets 6+7 (Ancient + Divine) averaged as the practical high-skill proxy instead.
- **Rate limiting (`HTTP 429`) shows up under sustained load** — a full 127-hero × ~4-requests-each run will hit some 429s toward the end. Build in retry-with-backoff and graceful degradation (empty result, not a crash) per hero; expect to need a small targeted re-fetch pass afterward for whichever heroes came back empty.

---

## `shared` workspace package: import by name, not by relative path into its source

`client`/`server` must import from `'shared'` (the package name), never `'../../../shared/types/whatever'` (deep relative path into its `.ts` source). Deep imports:

- break `tsc` builds in `server` (`rootDir` violation — files outside `server/src` end up in the compiled program), and
- in the browser, load `shared`'s built CommonJS output raw, which throws `ReferenceError: require is not defined` since it's never bundled/transformed.

Additionally, Vite doesn't auto-prebundle `shared` the way it does real `node_modules` dependencies (it's a workspace symlink, not really "in" `node_modules`), so its CommonJS build gets served as-is and breaks the same way. Fix: add `optimizeDeps: { include: ['shared'] }` to `client/vite.config.ts` so esbuild gives it the same CJS->ESM interop as everything else.

---

## Prisma + SQLite has no native `Json` field type

The SQLite connector rejects `Json` as a Prisma field type (`"can't be of type Json. The current connector does not support the Json type"`). Store arrays/objects as `String` columns and `JSON.stringify`/`JSON.parse` manually at the application boundary (see `hero.service.ts`, `draft.service.ts`).
