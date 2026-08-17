# Client telemetry

Events go to a `localStorage` ring buffer **and** `POST /api/telemetry`
(batched, best-effort). The server stores them in SQLite `FunnelEvent`.
No SaaS.

## Events

| name               | when                                                        |
| ------------------ | ----------------------------------------------------------- |
| `session_start`    | app mount (`main.tsx`)                                      |
| `draft_first_pick` | first pick creates the draft row                            |
| `draft_completed`  | roles assigned → `COMPLETED`                                |
| `evaluate_success` | Evaluate returns                                            |
| `battle_enter`     | Enter Battle Mode                                           |
| `battle_fight`     | fight starts (`n`, `auto`)                                  |
| `battle_outcome`   | roll settle (`outcome`, `confidenceTier`, `opponentSource`) |
| `draft_copy`       | copy draft clipboard                                        |
| `pool_commit`      | pool commit ok/fail                                         |
| `tapalka_click`    | first + every 10th tap                                      |

Funnel to watch: session → first pick → complete → evaluate → battle enter →
second fight → pool commit.

## Privacy

- `visitorId` = truncated sha256 of submitter token (never raw token)
- `draftKey` = truncated sha256 of draftId
- no hero lineups, clipboard text, or secrets

## Inspect

Browser console (this visitor only):

```js
await window.__DOTADRAFT_TELEMETRY__.dump();
window.__DOTADRAFT_TELEMETRY__.events();
window.__DOTADRAFT_TELEMETRY__.clear();
```

Aggregate (all visitors), if `TELEMETRY_READ_TOKEN` is set:

```bash
curl -H "X-Telemetry-Read-Token: $TELEMETRY_READ_TOKEN" http://localhost:8080/api/telemetry/funnel
```
