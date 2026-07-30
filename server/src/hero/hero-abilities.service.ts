import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import type { AbilityCategory, TopAbility } from 'shared';

interface RawAbility {
  abilityKey: string;
  abilityName: string;
  iconUrl: string;
  categoryScores: Partial<Record<AbilityCategory, number>>;
}

interface RawHeroAbilities {
  heroId: number;
  abilities: RawAbility[];
}

const HERO_ABILITIES_PATH = path.join(__dirname, '..', '..', 'data', 'hero-abilities.json');

// Blueprint/10-tech-debt-backlog.md, "Хайлайт топ-контрибьюторов по оси" —
// same load-once-at-module-init pattern as HeroMetaService/axis-weights.json
// (server/src/battle/battle-resolution.ts). ~1.5MB, loaded once, not per
// request.
const rawData: RawHeroAbilities[] = JSON.parse(fs.readFileSync(HERO_ABILITIES_PATH, 'utf-8'));
const abilitiesByHeroId = new Map<number, RawAbility[]>(rawData.map((h) => [h.heroId, h.abilities]));

@Injectable()
export class HeroAbilitiesService {
  // Top N abilities of a hero for a given category, by that ability's own
  // hand-tagged categoryScores value (server/data/ability-tagging.csv via
  // the import-ability-tagging.ts -> hero-abilities.json pipeline — see
  // Blueprint/09-hero-knowledge-base.md). Abilities with no score (or 0)
  // for this category are excluded, not just sorted last.
  topAbilities(heroId: number, category: AbilityCategory, limit: number): TopAbility[] {
    const abilities = abilitiesByHeroId.get(heroId) ?? [];
    return abilities
      .map((a) => ({ ability: a, score: a.categoryScores[category] ?? 0 }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ ability, score }) => ({
        abilityKey: ability.abilityKey,
        abilityName: ability.abilityName,
        iconUrl: ability.iconUrl,
        score,
      }));
  }
}
