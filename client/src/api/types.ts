import type { Hero } from '../../../shared/types/hero';

export interface DraftHeroView {
  heroId: number;
  hero: Hero;
  assignedRole: string | null;
  pickOrder: number;
}

export interface DraftStateView {
  id: string;
  status: 'PICKING' | 'ASSIGNING_ROLES' | 'COMPLETED';
  heroes: DraftHeroView[];
  pool: Hero[];
  createdAt: string;
}
