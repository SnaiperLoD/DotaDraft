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
