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

export interface HistoryEntry {
  id: string;
  heroes: HistoryDraftHero[];
  createdAt: string;
}
