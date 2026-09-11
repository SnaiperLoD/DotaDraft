import type { EvaluationResult } from './evaluation';
import type { Hero } from './hero';
import type { TiPlacementKind } from './ti-run';

export type DraftStatus = 'PICKING' | 'ASSIGNING_ROLES' | 'COMPLETED';

export type DraftMode = 'battle' | 'captains' | 'captains_ai' | 'ti';

// Round 1's offered pool, generated without persisting anything — the
// Draft row is not written until the first pick (see CreateDraftRequest
// and DraftService.create). `seed` is what the client hands back to
// identify which pool it is picking from; the server recomputes the pool
// from it rather than trusting a client-supplied hero list.
export interface DraftPoolResponse {
  seed: number;
  pool: Hero[];
}

// The first pick, which is also what creates the draft.
export interface CreateDraftRequest {
  seed: number;
  heroId: number;
  // Whether the player spent their single re-roll during round 1, i.e.
  // before there was a row to count it on. Client-asserted by necessity —
  // and no weaker than before in practice, since reloading the page has
  // always produced a fresh pool with a fresh allowance.
  rerollUsed: boolean;
  // Isolated product mode. This endpoint only accepts battle (default) or
  // ti — Captains creates drafts via createFromHeroIds, not POST /draft.
  mode?: Extract<DraftMode, 'battle' | 'ti'>;
}

export interface DraftHero {
  heroId: number;
  assignedRole: string | null;
  pickOrder: number;
}

export interface Draft {
  id: string;
  status: DraftStatus;
  heroes: DraftHero[];
  pool: number[];
  createdAt: string;
}

export interface PickRequest {
  heroId: number;
}

export interface RoleAssignment {
  heroId: number;
  role: string;
}

export interface AssignRolesRequest {
  assignments: RoleAssignment[];
}

export interface HistoryDraftHero extends DraftHero {
  heroName: string;
}

// One row per Battle Mode fight against this draft (Blueprint/10-tech-debt-backlog.md,
// "Сохранять в истории результаты боёв") — a draft can have 0..N of these,
// designed 1:many up front since "series of battles" (06-battle-engine.md)
// is a planned-but-unbuilt future mechanic that would otherwise force a
// reshape later.
export interface HistoryBattleSummary {
  id: number;
  resolvedOutcome: string;
  advantageDirection: string;
  confidenceTier: string;
  opponentSource: string;
  opponentTeamName: string | null;
  opponentLeagueName: string | null;
  opponentHeroIds: number[];
  stage: string | null;
  opponentMatchId: string | null;
  createdAt: string;
}

export type HistoryTiStatus = 'PLAYING' | 'CHAMPION' | 'ELIMINATED';

export interface HistoryTiSummary {
  runId: string;
  leagueName: string;
  teamName: string;
  status: HistoryTiStatus;
  /** Coarse finish from the occupy-slot graph; never a fake 16-team table. */
  placement: TiPlacementKind;
  lastRound: string | null;
}

export interface HistoryEntry {
  id: string;
  mode: DraftMode;
  heroes: HistoryDraftHero[];
  createdAt: string;
  // Most recent EvaluationResult for this draft, null until "Evaluate
  // Draft" has been clicked at least once.
  evaluation: EvaluationResult | null;
  battles: HistoryBattleSummary[];
  ti: HistoryTiSummary | null;
}
