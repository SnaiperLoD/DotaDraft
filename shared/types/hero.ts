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
  // Damage per team-networth-share (server/scripts/fetch-damage-networth-share-data.ts):
  // resource-efficiency read on damage output, distinct from teamfight's raw
  // hero_damage_per_min — see Blueprint/09-hero-knowledge-base.md. Evaluation
  // Engine-only (not in Battle Engine's AXES/axis-weights.json): no
  // real-winRate validation yet, unlike skirmish_rate/camp_stacking before
  // they were wired into Battle Engine.
  resource_efficiency: number;
}

export type PresumedPosition = 'Carry' | 'Mid' | 'Offlane' | 'Support';

export interface HeroPositionShare {
  position: PresumedPosition;
  share: number;
}

// Marker for a (hero, role) combination without enough real match data to
// trust a role-specific recalibration (Blueprint/12-next-session-priorities.md
// item 6) — the >8%-of-hero's-total-games threshold, computed in
// calibrate-role-evaluation-values.ts. What a consumer does when it hits
// no_info is a separate, still-open fallback-policy question; the type only
// records that the data doesn't exist yet, not what to do about it.
export interface RoleNoInfo {
  no_info: true;
}

export type RoleEvaluationEntry = HeroEvaluationValues | RoleNoInfo;

export interface Hero {
  id: number;
  name: string;
  primary_attribute: string;
  attack_type: string;
  roles: string[];
  tags: string[];
  synergy_tags: string[];
  counter_tags: string[];
  // Hero-level aggregate across all roles — unchanged calculation
  // (calibrate-evaluation-values.ts). Kept alongside evaluation_values_by_role
  // (not replaced by it) specifically to serve as the fallback value for any
  // role marked no_info there, since the real fallback POLICY for those roles
  // is still an open decision — see resolveEvaluationValues in
  // shared/utils/evaluationValues.ts.
  evaluation_values: HeroEvaluationValues;
  // Per-role recalibration where enough real data exists (calibrate-role-
  // evaluation-values.ts) — always has all 4 PresumedPosition keys, each
  // either real per-role values or { no_info: true }. Read this through
  // resolveEvaluationValues(), not directly, so the no_info fallback stays in
  // one place.
  evaluation_values_by_role: Record<PresumedPosition, RoleEvaluationEntry>;
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
