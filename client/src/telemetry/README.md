# Client telemetry (local funnel buffer)

No SaaS. Events append to `localStorage` key `dotadraft.telemetry.v1`
(ring buffer, max 200). Swap sink later via `setTelemetrySink()`.

## Events

| name               | when                                                        |
| ------------------ | ----------------------------------------------------------- |
| `session_start`    | app mount (`main.tsx`)                                      |
| `draft_completed`  | roles assigned → `COMPLETED`                                |
| `evaluate_success` | Evaluate returns                                            |
| `battle_enter`     | Enter Battle Mode                                           |
| `battle_fight`     | fight starts (`n`, `auto`)                                  |
| `battle_outcome`   | roll settle (`outcome`, `confidenceTier`, `opponentSource`) |
| `draft_copy`       | copy draft clipboard                                        |
| `pool_commit`      | pool commit ok/fail                                         |
| `tapalka_click`    | first + every 10th tap                                      |

## Privacy

- `visitorId` = truncated sha256 of submitter token (never raw token)
- `draftKey` = truncated sha256 of draftId
- no hero lineups, clipboard text, or secrets

## Inspect

In the browser console:

```js
await window.__DOTADRAFT_TELEMETRY__.dump();
window.__DOTADRAFT_TELEMETRY__.events();
window.__DOTADRAFT_TELEMETRY__.clear();
```
