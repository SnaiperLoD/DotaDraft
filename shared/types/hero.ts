export interface HeroEvaluationValues {
  teamfight: number;
  tempo: number;
  scaling: number;
  mobility: number;
  objectives: number;
  control: number;
  durability: number;
  burst: number;
  vision: number;
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
}
