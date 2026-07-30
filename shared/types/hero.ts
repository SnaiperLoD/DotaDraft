export interface HeroEvaluationValues {
  teamfight: number;
  tempo: number;
  scaling: number;
  mobility: number;
  objectives: number;
  control: number;
  durability: number;
  burst: number;
  map_control: number;
  saving: number;
  initiating: number;
  skirmish_rate: number;
  camp_stacking: number;
}

export type PresumedPosition = 'Carry' | 'Mid' | 'Offlane' | 'Support';

export interface HeroPositionShare {
  position: PresumedPosition;
  share: number;
}

export interface Hero {
  id: number;
  name: string;
  primary_attribute: string;
  attack_type: string;
  roles: string[];
  tags: string[];
  synergy_tags: string[];
  counter_tags: string[];
  evaluation_values: HeroEvaluationValues;
  presumed_positions: HeroPositionShare[];
}

// Live golden/red-border synergy highlight (Blueprint/10-tech-debt-backlog.md,
// "Живая подсветка синергичного пика").
export interface SynergyPreviewRequest {
  pickedHeroIds: number[];
  candidateHeroIds: number[];
}

export interface SynergyPreviewEntry {
  heroId: number;
  // Real co-pick winRate minus expected, averaged over already-picked
  // heroes (same formula as Synergy Analyzer) — null if there's no real
  // data for this candidate against any picked hero, or no picked heroes
  // yet. Ranking (top/bottom-of-pool) happens client-side.
  score: number | null;
}

// GET /heroes/:id/top-abilities response entry — Blueprint/10-tech-debt-backlog.md,
// "Хайлайт топ-контрибьюторов по оси". `score` is the ability's raw
// categoryScores value from the hand-tagged ability-tagging pipeline
// (server/data/hero-abilities.json), not a 0-10/percentile value.
export interface TopAbility {
  abilityKey: string;
  abilityName: string;
  iconUrl: string;
  score: number;
}
