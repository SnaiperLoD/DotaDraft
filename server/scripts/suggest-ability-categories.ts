import * as fs from 'fs';
import * as path from 'path';

// Candidate-surfacing helper for the manual hero-abilities.json tagging pass
// (Blueprint/10-tech-debt-backlog.md, "Оценить наличие данных по силе
// способностей..."). Keyword search on ability name+description is NOT a
// reliable auto-classifier — validated against the existing hand-authored
// mobility_ability_tier list and found real precision/recall problems (Dota
// terminology overloads common words: "charge" means both dash and ability
// resource, "jump" describes both hero movement and a projectile bouncing
// between targets; named abilities like Waveform/Shukuchi have no
// descriptive movement verb at all). This script only narrows ~750
// abilities down to a smaller candidate list per category for a human to
// read and confirm/reject — it does NOT write categoryScores itself.
const HERO_ABILITIES_PATH = path.join(__dirname, '..', 'data', 'hero-abilities.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'ability-category-candidates.json');

interface AbilityRecord {
  abilityKey: string;
  abilityName: string;
  description: string;
  categoryScores: Record<string, number>;
}

interface HeroAbilitiesFile {
  heroId: number;
  heroName: string;
  abilities: AbilityRecord[];
}

interface Candidate {
  heroName: string;
  abilityKey: string;
  abilityName: string;
  matchedKeyword: string;
  description: string;
}

// Word-boundary matches only — a naive substring match on e.g. "fly" also
// hits "briefly", which produced false positives during validation.
//
// initiating deliberately overlaps mobility on gap-closing verbs (blink,
// leap, charge...) — the same ability can score high on both (Legion
// Commander's Duel-adjacent Overwhelming Odds isn't a gap-closer, but her
// kit's Charge-of-Darkness style abilities elsewhere in the roster are both
// "mobility" for escape/reposition AND "initiating" for closing onto an
// enemy). The candidate list just narrows what to look at; the two scores
// are judged independently by hand. Added forced-displacement verbs
// (hook/pull/drag/toss) that mobility doesn't need since those target the
// enemy, not the caster.
//
// control_strength intentionally casts wider than the old mobility/saving
// filters — it's meant to catch both the hard disables `stuns` already
// counts (stun/hex/root) and the soft ones it misses (silence/slow/fear),
// so recall matters more here than usual.
const CATEGORY_KEYWORDS: Record<string, RegExp> = {
  mobility: /\b(blink|teleport|dash|leap|jump|charge|burrow|flies|flying|fly|warp|phase shift|swaps?)\b/i,
  saving: /\b(heal|healing|health|restor(e|ation|es)|regenerat\w*|reviv\w*|resurrect\w*|invulnerab\w*)\b/i,
  initiating: /\b(blink|teleport|dash|leap|jump|charge|pounces?|hooks?|pulls?|drags?|tosses?|impales?|chains?|nets?)\b/i,
  control_strength:
    /\b(stuns?|stunned|hex(es)?|root(s|ed)?|silenc(e|es|ed|ing)|fear(s|ed)?|sleep(s)?|taunt(s|ed)?|slow(s|ed)?|disarm(s|ed)?|mute(s|d)?|polymorph)\b/i,
};

function main() {
  const heroAbilities: HeroAbilitiesFile[] = JSON.parse(fs.readFileSync(HERO_ABILITIES_PATH, 'utf-8'));

  const candidatesByCategory: Record<string, Candidate[]> = {};
  for (const category of Object.keys(CATEGORY_KEYWORDS)) candidatesByCategory[category] = [];

  let totalAbilities = 0;

  for (const hero of heroAbilities) {
    for (const ability of hero.abilities) {
      if (!ability.description) continue;
      totalAbilities++;
      const text = `${ability.abilityName} ${ability.description}`;

      for (const [category, pattern] of Object.entries(CATEGORY_KEYWORDS)) {
        const match = text.match(pattern);
        if (match) {
          candidatesByCategory[category].push({
            heroName: hero.heroName,
            abilityKey: ability.abilityKey,
            abilityName: ability.abilityName,
            matchedKeyword: match[0],
            description: ability.description,
          });
        }
      }
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(candidatesByCategory, null, 2) + '\n');

  console.log(`Scanned ${totalAbilities} abilities with a description.\n`);
  for (const [category, candidates] of Object.entries(candidatesByCategory)) {
    console.log(
      `${category}: ${candidates.length} candidates (${((candidates.length / totalAbilities) * 100).toFixed(0)}% of abilities) — review these, not the full list.`,
    );
  }
  console.log(`\nFull candidate lists written to ${OUTPUT_PATH}.`);
  console.log('Reminder: this is a recall-oriented filter, not a scorer. Confirm/reject each candidate by hand.');
}

main();
