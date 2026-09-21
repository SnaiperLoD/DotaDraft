import type { HeroEvaluationValues } from 'shared';

export const AXES: (keyof HeroEvaluationValues)[] = [
  'teamfight',
  'tempo',
  'scaling',
  'mobility',
  'objectives',
  'control',
  'durability',
  'burst',
  'map_control',
  'saving',
  'initiating',
  'skirmish_rate',
  'camp_stacking',
  'resource_efficiency',
];

export const AXIS_LABEL: Record<keyof HeroEvaluationValues, string> = {
  // "damage output", not "teamfight" — see score-narrative.ts's
  // AXIS_NARRATIVE.teamfight comment (label-only rename, key unchanged).
  teamfight: 'damage output',
  tempo: 'tempo',
  scaling: 'late-game scaling',
  mobility: 'mobility',
  objectives: 'tower pressure',
  control: 'control',
  durability: 'durability',
  burst: 'burst damage',
  map_control: 'map control',
  saving: 'ally saving power',
  initiating: 'initiation potential',
  skirmish_rate: 'how often they fight',
  camp_stacking: 'camp stacking',
  // Not in AXES below (Evaluation Engine-only axis, see
  // calibrate-evaluation-values.ts). Entry exists only because AXIS_LABEL's
  // type is total over HeroEvaluationValues. Battle advantages now send the
  // raw axis key; AXIS_LABEL still feeds Evaluation Fundamentals copy.
  resource_efficiency: 'resource efficiency',
};
