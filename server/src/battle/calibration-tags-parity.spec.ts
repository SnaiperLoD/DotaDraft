// Parity guard: the always-hidden calibration tags are applied on two sides —
// Evaluation (common/calibration-tags.ts) and Battle (battle/custom-tags.ts).
// Battle imports the sets and magnitudes from common (single source); this
// spec fails if either side stops applying them identically, and pins the
// magnitudes so a silent calibration change is caught.
import type { Hero, HeroEvaluationValues } from 'shared';
import { CUSTOM_TAG_DEFINITIONS } from 'shared';
import {
  DISABLE_BATTERY,
  DIVIDED_ATTENTION,
  FALSE_IMMORTAL,
  HAUNT_ABSOLUTE,
  PAPER_UTILITY,
  RAID_BOSS,
  SHOWSTOPPER_TAX,
  SIEGE_VOLTAGE,
  SUMMONING_SICKNESS,
  TEMPO_MONSTER,
  calibrationMultipliersForTeam,
} from '../common/calibration-tags';
import { blessingEffectsFor } from './custom-tags';
import { makeHero } from '../test-utils/hero-factory';

type Axis = keyof HeroEvaluationValues;
const AXES: Axis[] = ['scaling', 'durability', 'objectives', 'map_control'];

// Heroes also carrying any non-hidden-calibration tag are excluded from the solo
// comparison: Battle layers extra visible-tag effects on them that Evaluation
// intentionally does not mirror.
const HIDDEN_TAG_NAMES = new Set([
  'Divided Attention',
  'Tempo Monster',
  'Summoning Sickness',
  'Paper Utility',
  'Showstopper Tax',
  'False Immortal',
  'Raid Boss',
  'Disable Battery',
  'Haunt Absolute',
  'Siege Voltage',
]);
const BATTLE_ONLY = CUSTOM_TAG_DEFINITIONS.filter((t) => !HIDDEN_TAG_NAMES.has(t.name)).map(
  (t) => new Set<string>(t.heroNames ?? []),
);
const FLAT_POWER: Array<[string, ReadonlySet<string>, number]> = [
  ['Summoning Sickness', SUMMONING_SICKNESS, 0.7],
  ['Paper Utility', PAPER_UTILITY, 0.75],
  ['Showstopper Tax', SHOWSTOPPER_TAX, 0.75],
  ['False Immortal', FALSE_IMMORTAL, 0.82],
  ['Raid Boss', RAID_BOSS, 1.18],
  ['Disable Battery', DISABLE_BATTERY, 1.25],
  ['Haunt Absolute', HAUNT_ABSOLUTE, 1.12],
  ['Siege Voltage', SIEGE_VOLTAGE, 1.12],
];

function heroesOf(names: Iterable<string>, tempo: number): Hero[] {
  let id = 1;
  return [...names].map((name) =>
    makeHero({
      id: id++,
      name,
      evaluation_values: { ...makeHero({ id: 0, name: '' }).evaluation_values, tempo },
    }),
  );
}

describe('hidden calibration tags: Evaluation/Battle parity', () => {
  it.each(FLAT_POWER)('%s: pinned flat power magnitude and non-empty roster', (_n, set, magnitude) => {
    expect(set.size).toBeGreaterThan(0);
    const hero = heroesOf([[...set][0]], 3)[0];
    expect(calibrationMultipliersForTeam([hero]).get(hero.id)!.power).toBeCloseTo(
      // a hero may sit in several sets; only assert when it is in this one alone
      magnitude * otherSetsFactor(hero.name, set),
    );
  });

  it('Divided Attention / Tempo Monster: pinned magnitudes', () => {
    const da = heroesOf(DIVIDED_ATTENTION, 3);
    const m = calibrationMultipliersForTeam([da[0]]).get(da[0].id)!;
    // tempo 3 (<= 8): Tempo Monster penalty may also apply to the same hero
    const alsoTempo = TEMPO_MONSTER.has(da[0].name);
    expect(m.axis.objectives).toBeCloseTo(0.9);
    expect(m.axis.durability).toBeCloseTo(alsoTempo ? 0.9 * 0.75 : 0.9);
    const tm = heroesOf(TEMPO_MONSTER, 9);
    expect(calibrationMultipliersForTeam([tm[0]]).get(tm[0].id)!.power).toBeCloseTo(
      1.03 * otherSetsFactor(tm[0].name, TEMPO_MONSTER),
    );
    const lowTempo = calibrationMultipliersForTeam([heroesOf(TEMPO_MONSTER, 3)[0]]).get(1)!;
    expect(lowTempo.axis.scaling).toBeCloseTo(0.75);
    expect(lowTempo.axis.map_control).toBeCloseTo(0.75);
  });

  const allNames = [
    ...new Set([
      ...DIVIDED_ATTENTION,
      ...TEMPO_MONSTER,
      ...SUMMONING_SICKNESS,
      ...PAPER_UTILITY,
      ...SHOWSTOPPER_TAX,
      ...FALSE_IMMORTAL,
      ...RAID_BOSS,
      ...DISABLE_BATTERY,
      ...HAUNT_ABSOLUTE,
      ...SIEGE_VOLTAGE,
    ]),
  ];

  it.each([3, 9])(
    'every tagged hero gets identical solo multipliers on both sides (team tempo %i)',
    (tempo) => {
      let compared = 0;
      for (const name of allNames) {
        if (BATTLE_ONLY.some((set) => set.has(name))) continue;
        compared++;
        const hero = heroesOf([name], tempo)[0];
        const evalSide = calibrationMultipliersForTeam([hero]).get(hero.id)!;
        const battle = blessingEffectsFor([hero], { tempo });
        expect({ hero: name, power: battle.heroPowerMultiplier.get(hero.id) ?? 1 }).toEqual({
          hero: name,
          power: expect.closeTo(evalSide.power, 10),
        });
        const bAxis = battle.heroAxisMultiplier.get(hero.id) ?? {};
        for (const axis of AXES) {
          expect({ hero: name, axis, v: bAxis[axis] ?? 1 }).toEqual({
            hero: name,
            axis,
            v: expect.closeTo(evalSide.axis[axis] ?? 1, 10),
          });
        }
      }
    },
  );
});

function otherSetsFactor(name: string, own: ReadonlySet<string>): number {
  // Product of the *other* flat-power tags the same hero carries (multipliers compose).
  let f = 1;
  for (const [, set, mag] of FLAT_POWER) if (set !== own && set.has(name)) f *= mag;
  return f;
}
