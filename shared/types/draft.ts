import type { EvaluationResult } from './evaluation';

export type DraftStatus = 'PICKING' | 'ASSIGNING_ROLES' | 'COMPLETED';

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
  createdAt: string;
}

export interface HistoryEntry {
  id: string;
  heroes: HistoryDraftHero[];
  createdAt: string;
  // Most recent EvaluationResult for this draft, null until "Evaluate
  // Draft" has been clicked at least once.
  evaluation: EvaluationResult | null;
  battles: HistoryBattleSummary[];
}
