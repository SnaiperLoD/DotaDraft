export type PooledDraftSource = 'player' | 'pro';

export interface PooledHeroRole {
  heroId: number;
  role: string;
  // OpenDota personaname (falls back to in-game `name`) of the player who
  // played this hero in the source match — only ever set for 'pro' rows,
  // where a real match backs the pick. undefined/null for 'player' rows
  // and for pro rows imported before this field existed (backfilled via
  // server/scripts/backfill-pro-match-roles.ts). See
  // Blueprint/10-tech-debt-backlog.md, "Имена про-игроков под портретами
  // героев в Battle".
  playerName?: string | null;
}

export interface PooledDraftSummary {
  id: string;
  source: PooledDraftSource;
  heroIds: number[];
  // null for rows committed before role-fit reached Battle Engine — see
  // Blueprint/10-tech-debt-backlog.md, "Role-fit in Battle Engine".
  heroRoles: PooledHeroRole[] | null;
  teamName: string | null;
  leagueName: string | null;
  // OpenDota matchId for 'pro' rows (derived from the deterministic
  // `pro-${matchId}` id scheme, see seed-opponent-pool.ts — no separate
  // column needed). Always null for 'player' rows (no real match backs
  // them). See Blueprint/10-tech-debt-backlog.md, "Ссылка на исходный матч
  // для про-пиков".
  matchId: string | null;
}

export interface CommitDraftRequest {
  draftId: string;
  submitterToken: string;
}

export interface CommitDraftResponse {
  id: string;
  committedAt: string;
}

// GET /leaderboard — Blueprint/10-tech-debt-backlog.md, "Лидерборд
// драфтов". Each row is one committed PooledDraft (player or pro), ranked
// by how it performs as the OPPONENT when other players' battles pull it
// — not the committing player's own battle record (that isn't tracked at
// all; see OpponentPoolService.recordDraftOutcome). No account system —
// `isMine` is computed server-side from the caller's owner token so the
// raw submitterToken never leaves the pool DB.
export interface LeaderboardEntryView {
  id: string;
  source: PooledDraftSource;
  heroIds: number[];
  heroRoles: PooledHeroRole[] | null;
  teamName: string | null;
  leagueName: string | null;
  // Snapshot of the draft's Evaluation total score at commit time — null
  // if it was never evaluated before committing.
  evaluationScore: number | null;
  isMine: boolean;
  wins: number;
  losses: number;
  winRate: number;
}

// One "run" on the Best Runs board — a player's own single-session draft and
// how it did across the Battle Mode fights they played WITH it (the caller's
// perspective, aggregated from BattleResult rows keyed by draftId). This is
// the counterpart to LeaderboardEntryView: that one ranks a pooled draft by
// how it does AS AN OPPONENT other players pull; this one ranks the player's
// own active session. Scoped to the anonymous ownerToken on Draft.
export interface RunLeaderboardEntry {
  draftId: string;
  heroIds: number[];
  // assignedRole per hero, same order as heroIds (a COMPLETED draft always has
  // roles, but kept nullable to mirror PooledDraftSummary's shape and survive
  // any legacy row without them).
  heroRoles: PooledHeroRole[] | null;
  // Draft's most recent Evaluation total score (from Draft.evaluationResult) —
  // null if the player never clicked Evaluate before fighting.
  evaluationScore: number | null;
  wins: number;
  losses: number;
  winRate: number;
}

// GET /leaderboard now returns both boards in one response — the two "parts"
// of the leaderboard: `runs` (the player's best single-session runs) and
// `pool` (pooled drafts ranked by their passive opponent record).
export interface LeaderboardResponse {
  runs: RunLeaderboardEntry[];
  pool: LeaderboardEntryView[];
}
