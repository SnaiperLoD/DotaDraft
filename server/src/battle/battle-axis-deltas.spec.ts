// T1.5 step 1 (Blueprint/15-dev-plan-2026-10.md): axisPowerDeltas promises that
// its per-axis contributions sum to the TAGGED power gap (custom tags applied,
// before the synergy / matchup / real-winRate multipliers). The older spec only
// checked rawDiff on untagged synthetic heroes. This one checks real 5v5 drafts
// from the local snapshot, where blessing/curse/hard-carry/utility/manual-power
// and shutdown effects are live.
import * as fs from 'fs';
import * as path from 'path';
import type { DraftRole, Hero } from 'shared';
import { ROLES } from 'shared';
import { HeroMetaService } from '../hero-meta/hero-meta.service';
import { assessBattle, type BattlePick } from './battle-resolution';
import { BATTLE_SHADOW } from './battle-shadow';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const ROLES_LIST = [...ROLES] as DraftRole[];
const PAIRS = 300;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function loadHeroes(): Hero[] {
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'heroes.json'), 'utf8')) as Hero[];
  return raw.map((hero) => ({
    ...hero,
    presumed_positions: hero.presumed_positions ?? [],
    evaluation_values_by_role: hero.evaluation_values_by_role ?? {
      Carry: { no_info: true },
      Mid: { no_info: true },
      Offlane: { no_info: true },
      Support: { no_info: true },
    },
  }));
}

const shadowOff = BATTLE_SHADOW === 'off';
(shadowOff ? describe : describe.skip)('axisPowerDeltas vs the tagged power gap (T1.5)', () => {
  const heroes = loadHeroes();
  const lookup = new HeroMetaService();
  const rand = mulberry32(20261002);
  const fights = Array.from({ length: PAIRS }, () => {
    const pool = shuffle(heroes, rand);
    const rolesA = shuffle(ROLES_LIST, rand);
    const rolesB = shuffle(ROLES_LIST, rand);
    const teamA: BattlePick[] = pool.slice(0, 5).map((hero, k) => ({ hero, assignedRole: rolesA[k] }));
    const teamB: BattlePick[] = pool.slice(5, 10).map((hero, k) => ({ hero, assignedRole: rolesB[k] }));
    return assessBattle(teamA, teamB, lookup);
  });

  it('per-axis contributions sum to taggedPowerA − taggedPowerB on real drafts', () => {
    const off = fights
      .map((fight, i) => ({
        i,
        sum: fight.axisDeltas.reduce((total, row) => total + row.delta, 0),
        taggedGap: fight.taggedPowerA - fight.taggedPowerB,
      }))
      .filter(({ sum, taggedGap }) => Math.abs(sum - taggedGap) > 1e-9);
    expect(off.slice(0, 5)).toEqual([]);
  });

  it('the multiplier remainder (diff − tagged gap) is what the axes do not explain', () => {
    for (const fight of fights) {
      const remainder = fight.diff - (fight.taggedPowerA - fight.taggedPowerB);
      expect(fight.multiplierRemainder).toBeCloseTo(remainder, 12);
    }
  });
});
