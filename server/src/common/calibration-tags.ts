// Always-hidden calibration tags that must affect Evaluation Total Score
// as well as Battle (user: balance crutches are part of the model, not
// flavour). Magnitudes kept in sync by hand with battle/custom-tags.ts —
// Core Rules Separation: Evaluation must not import Battle.
// Opponent-only curses (Agility Crusher, etc.) stay Battle-only.
import type { Hero, HeroEvaluationValues } from 'shared';
import { heroNameSetForTag } from 'shared';
import { isHardCarry } from './hard-carry';

type Axis = keyof HeroEvaluationValues;

const DIVIDED_ATTENTION = heroNameSetForTag('Divided Attention');
const DIVIDED_ATTENTION_PENALTY = 0.9;
const TEMPO_MONSTER = heroNameSetForTag('Tempo Monster');
const TEMPO_MONSTER_THRESHOLD = 8;
const TEMPO_MONSTER_BUFF = 1.03;
const TEMPO_MONSTER_PENALTY = 0.75;
const TEMPO_MONSTER_HARD_CARRY_PENALTY = 0.9;
const SUMMONING_SICKNESS = heroNameSetForTag('Summoning Sickness');
const SUMMONING_SICKNESS_PENALTY = 0.7;
const PAPER_UTILITY = heroNameSetForTag('Paper Utility');
const PAPER_UTILITY_PENALTY = 0.75;
const SHOWSTOPPER_TAX = heroNameSetForTag('Showstopper Tax');
const SHOWSTOPPER_TAX_PENALTY = 0.75;
const FALSE_IMMORTAL = heroNameSetForTag('False Immortal');
const FALSE_IMMORTAL_PENALTY = 0.82;
const RAID_BOSS = heroNameSetForTag('Raid Boss');
const RAID_BOSS_BUFF = 1.18;
const DISABLE_BATTERY = heroNameSetForTag('Disable Battery');
const DISABLE_BATTERY_BUFF = 1.25;
const HAUNT_ABSOLUTE = heroNameSetForTag('Haunt Absolute');
const HAUNT_ABSOLUTE_BUFF = 1.12;
const SIEGE_VOLTAGE = heroNameSetForTag('Siege Voltage');
const SIEGE_VOLTAGE_BUFF = 1.12;

export interface CalibrationTagMultipliers {
  /** Flat multiplier on every axis value for this hero. */
  power: number;
  /** Extra per-axis multipliers (composed on top of power). */
  axis: Partial<Record<Axis, number>>;
}

function emptyMult(): CalibrationTagMultipliers {
  return { power: 1, axis: {} };
}

function mulAxis(m: CalibrationTagMultipliers, axis: Axis, factor: number): void {
  m.axis[axis] = (m.axis[axis] ?? 1) * factor;
}

/**
 * Per-hero multipliers from always-hidden balance tags for a single team
 * (no opponent). Used by Evaluation axis analyzers so Total Score includes
 * the same crutches Battle applies on the blessing side.
 */
export function calibrationMultipliersForTeam(team: Hero[]): Map<number, CalibrationTagMultipliers> {
  const out = new Map<number, CalibrationTagMultipliers>();
  for (const h of team) out.set(h.id, emptyMult());

  const teamTempo =
    team.length === 0 ? 0 : team.reduce((s, h) => s + (h.evaluation_values.tempo ?? 5), 0) / team.length;

  for (const h of team) {
    const m = out.get(h.id)!;
    if (DIVIDED_ATTENTION.has(h.name)) {
      mulAxis(m, 'durability', DIVIDED_ATTENTION_PENALTY);
      mulAxis(m, 'objectives', DIVIDED_ATTENTION_PENALTY);
    }
    if (SUMMONING_SICKNESS.has(h.name)) {
      m.power *= SUMMONING_SICKNESS_PENALTY;
    }
    if (PAPER_UTILITY.has(h.name)) {
      m.power *= PAPER_UTILITY_PENALTY;
    }
    if (SHOWSTOPPER_TAX.has(h.name)) {
      m.power *= SHOWSTOPPER_TAX_PENALTY;
    }
    if (FALSE_IMMORTAL.has(h.name)) {
      m.power *= FALSE_IMMORTAL_PENALTY;
    }
    if (RAID_BOSS.has(h.name)) {
      m.power *= RAID_BOSS_BUFF;
    }
    if (DISABLE_BATTERY.has(h.name)) {
      m.power *= DISABLE_BATTERY_BUFF;
    }
    if (HAUNT_ABSOLUTE.has(h.name)) {
      m.power *= HAUNT_ABSOLUTE_BUFF;
    }
    if (SIEGE_VOLTAGE.has(h.name)) {
      m.power *= SIEGE_VOLTAGE_BUFF;
    }
    if (TEMPO_MONSTER.has(h.name)) {
      if (teamTempo > TEMPO_MONSTER_THRESHOLD) {
        m.power *= TEMPO_MONSTER_BUFF;
      } else {
        mulAxis(m, 'scaling', TEMPO_MONSTER_PENALTY);
        mulAxis(m, 'durability', TEMPO_MONSTER_PENALTY);
        mulAxis(m, 'map_control', TEMPO_MONSTER_PENALTY);
      }
      if (team.some((other) => other.id !== h.id && isHardCarry(other))) {
        m.power *= TEMPO_MONSTER_HARD_CARRY_PENALTY;
      }
    }
  }

  return out;
}

export function teamHasHiddenCalibrationTags(team: Hero[]): boolean {
  return team.some(
    (h) =>
      DIVIDED_ATTENTION.has(h.name) ||
      SUMMONING_SICKNESS.has(h.name) ||
      TEMPO_MONSTER.has(h.name) ||
      PAPER_UTILITY.has(h.name) ||
      SHOWSTOPPER_TAX.has(h.name) ||
      FALSE_IMMORTAL.has(h.name) ||
      RAID_BOSS.has(h.name) ||
      DISABLE_BATTERY.has(h.name) ||
      HAUNT_ABSOLUTE.has(h.name) ||
      SIEGE_VOLTAGE.has(h.name),
  );
}
