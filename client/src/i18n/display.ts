import type { TFunction } from 'i18next';
import type { CustomTagDefinition } from 'shared';
import { CUSTOM_TAG_DEFINITIONS } from 'shared';

/** Stable i18n key fragment for a custom tag display name. */
export function customTagSlug(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function axisLabel(t: TFunction, key: string, fallback?: string): string {
  const path = `axes.${key}`;
  const translated = t(path);
  if (translated !== path) return translated;
  return fallback ?? key;
}

export function assignedRoleLabel(t: TFunction, role: string): string {
  const path = `roles.${role}`;
  const translated = t(path);
  return translated !== path ? translated : role;
}

export function dotaRoleLabel(t: TFunction, role: string): string {
  const path = `heroRoles.${role}`;
  const translated = t(path);
  return translated !== path ? translated : role;
}

export function attributeLabel(t: TFunction, attr: string): string {
  const path = `attributes.${attr}`;
  const translated = t(path);
  return translated !== path ? translated : attr;
}

export function customTagName(t: TFunction, name: string): string {
  const path = `customTags.${customTagSlug(name)}.name`;
  const translated = t(path);
  return translated !== path ? translated : name;
}

const STEALTH_STACK_PENALTY_PCT: Record<number, number> = { 2: 5, 3: 10, 4: 15, 5: 20 };
const MASS_BUFFER_BASE_PCT = 3;
const MASS_BUFFER_PER_EXTRA_PCT = 1;
const HEALER_BASE_PCT = 2;
const HEALER_PER_EXTRA_PCT = 1;

function joinAxisLabels(t: TFunction, labels: string[]): string {
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return t('customTags.dynamic.axisPair', { a: labels[0], b: labels[1] });
  return t('customTags.dynamic.axisList', {
    head: labels.slice(0, -1).join(', '),
    last: labels[labels.length - 1],
  });
}

/**
 * Localized Active Combos / badge tooltip copy. Mirrors shared describeActiveTag
 * count rules so RU/EN stay consistent when the server still sends English prose.
 */
export function customTagDescription(
  t: TFunction,
  tag: Pick<CustomTagDefinition, 'name' | 'description'>,
  opts: {
    teamHeroNames?: string[];
    /** Axis keys already chosen for Fundamentals (Eval fills these). */
    fundamentalsAxes?: string[];
  } = {},
): string {
  const def = CUSTOM_TAG_DEFINITIONS.find((d) => d.name === tag.name);
  const team = opts.teamHeroNames ?? [];
  const count = def ? team.filter((n) => def.heroNames.includes(n)).length : 0;

  if (tag.name === 'The Fundamentals') {
    if (count < 2 && team.length > 0) return t('customTags.dynamic.fundamentalsSolo');
    const axes = (opts.fundamentalsAxes ?? []).map((k) => axisLabel(t, k));
    if (axes.length === 0) {
      // Fall back to static catalog when Eval hasn't named axes yet / draft cards.
      const path = `customTags.${customTagSlug(tag.name)}.description`;
      const translated = t(path);
      return translated !== path ? translated : tag.description;
    }
    if (axes.length === 1) return t('customTags.dynamic.fundamentalsOne', { axes: axes[0] });
    return t('customTags.dynamic.fundamentalsMany', { axes: joinAxisLabels(t, axes) });
  }

  if (tag.name === 'Statstealer') {
    if (count >= 2) return t('customTags.dynamic.statstealerMany', { count });
    if (team.length > 0) return t('customTags.dynamic.statstealerSolo');
  }

  if (tag.name === 'Healer' && count >= 1) {
    const perHero = HEALER_BASE_PCT + HEALER_PER_EXTRA_PCT * (count - 1);
    if (count === 1) return t('customTags.dynamic.healerOne', { perHero });
    return t('customTags.dynamic.healerMany', { count, perHero, total: perHero * count });
  }

  if (tag.name === 'Mass Buffer' && count >= 1) {
    const perHero = MASS_BUFFER_BASE_PCT + MASS_BUFFER_PER_EXTRA_PCT * (count - 1);
    return t('customTags.dynamic.massBuffer', {
      count,
      perHero,
      total: perHero * count,
    });
  }

  if ((tag.name === 'Unseen' || tag.name === 'Army of Clones') && count >= 1) {
    const flavor =
      tag.name === 'Unseen' ? t('customTags.dynamic.unseenFlavor') : t('customTags.dynamic.armyFlavor');
    if (count < 2) return t('customTags.dynamic.stealthSolo', { flavor });
    const penalty = STEALTH_STACK_PENALTY_PCT[Math.min(count, 5)] ?? STEALTH_STACK_PENALTY_PCT[5];
    return t('customTags.dynamic.stealthMany', { flavor, count, penalty });
  }

  const path = `customTags.${customTagSlug(tag.name)}.description`;
  const translated = t(path);
  return translated !== path ? translated : tag.description;
}

export function badgeCopy(t: TFunction, id: string): { name: string; description: string } {
  const namePath = `badges.${id}.name`;
  const descPath = `badges.${id}.description`;
  const name = t(namePath);
  const description = t(descPath);
  return {
    name: name !== namePath ? name : id,
    description: description !== descPath ? description : '',
  };
}

/** Battle advantages/disadvantages: new payloads are axis keys; legacy History keeps English sentences. */
export function formatBattleAxisLine(t: TFunction, raw: string, kind: 'advantage' | 'disadvantage'): string {
  if (/^[a-z_]+$/i.test(raw) && t(`axes.${raw}`) !== `axes.${raw}`) {
    const axis = axisLabel(t, raw);
    return kind === 'advantage'
      ? t('battle.advantageEdge', { axis })
      : t('battle.advantageDeficit', { axis });
  }
  return raw;
}

export function formatPercentileLabel(t: TFunction, percentile: number): string {
  const ordinal = (n: number): string => {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return t('evaluation.ordinal.th', { n });
    switch (n % 10) {
      case 1:
        return t('evaluation.ordinal.st', { n });
      case 2:
        return t('evaluation.ordinal.nd', { n });
      case 3:
        return t('evaluation.ordinal.rd', { n });
      default:
        return t('evaluation.ordinal.th', { n });
    }
  };

  if (percentile < 30) return t('evaluation.percentile.bottom', { pct: Math.max(1, percentile) });
  if (percentile < 70) return t('evaluation.percentile.mid', { ordinal: ordinal(percentile) });
  return t('evaluation.percentile.top', { pct: Math.max(1, 100 - percentile) });
}

/** Parse Fundamentals axis names out of the English Eval description when meta isn't present. */
export function parseFundamentalsAxesFromDescription(description: string): string[] | undefined {
  const one = description.match(/weakest axis:\s*(.+)\.\s*$/i);
  const many = description.match(/weakest axes:\s*(.+)\.\s*$/i);
  const blob = one?.[1] ?? many?.[1];
  if (!blob) return undefined;
  const parts = blob.split(/,| and /).map((s) => s.trim()).filter(Boolean);
  const reverse: Record<string, string> = {
    'damage output': 'teamfight',
    tempo: 'tempo',
    'late-game scaling': 'scaling',
    scaling: 'scaling',
    mobility: 'mobility',
    'objective pressure': 'objectives',
    objectives: 'objectives',
    control: 'control',
    durability: 'durability',
    'burst damage': 'burst',
    burst: 'burst',
    'map control': 'map_control',
    'ally saving': 'saving',
    'ally saving power': 'saving',
    saving: 'saving',
    initiation: 'initiating',
    'initiation potential': 'initiating',
    initiating: 'initiating',
    'skirmish rate': 'skirmish_rate',
    'camp stacking': 'camp_stacking',
    'resource efficiency': 'resource_efficiency',
  };
  const keys = parts.map((p) => reverse[p.toLowerCase()]).filter(Boolean) as string[];
  return keys.length > 0 ? keys : undefined;
}
