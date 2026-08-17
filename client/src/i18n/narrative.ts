import type { TFunction } from 'i18next';
import type { LocalizedLine } from 'shared';
import { isI18nLine } from 'shared';
import { axisLabel, assignedRoleLabel, customTagName } from './display';

const NARRATIVE_KEYS = new Set(['eval.axis.narrative', 'eval.gameplan.leanOn', 'eval.gameplan.coverFor']);

function isNarrativeParams(params?: Record<string, string>): boolean {
  return Boolean(params?.axis && params?.bracket && params?.bodyBracket && params?.pct != null);
}

function joinAnd(t: TFunction, parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return t('eval.list.pair', { a: parts[0], b: parts[1] });
  return t('eval.list.many', { head: parts.slice(0, -1).join(', '), last: parts[parts.length - 1] });
}

function carriedClause(t: TFunction, params: Record<string, string>): string {
  const n = Number(params.carriedCount ?? 0);
  if (n === 1 && params.carried) return t('eval.lede.carriedOne', { name: params.carried });
  if (n >= 2 && params.carried) {
    const [a, b] = params.carried.split('|');
    return t('eval.lede.carriedTwo', { a: a ?? '', b: b ?? '' });
  }
  return '';
}

function composeAxisNarrative(t: TFunction, params: Record<string, string>): string {
  const axis = axisLabel(t, params.axis);
  const carried = carriedClause(t, params);
  const lede = t(`eval.lede.${params.bracket}`, { axis, pct: params.pct, carried });
  const bodyPath = `eval.body.${params.axis}.${params.bodyBracket}`;
  const body = t(bodyPath);
  const bodyText = body !== bodyPath ? body : '';
  return bodyText ? `${lede} ${bodyText}` : lede;
}

function formatAxisHeroList(t: TFunction, spec: string): string {
  if (!spec) return '';
  const parts = spec
    .split('|')
    .filter(Boolean)
    .map((part) => {
      const colon = part.indexOf(':');
      const axisKey = colon === -1 ? part : part.slice(0, colon);
      const hero = colon === -1 ? '' : part.slice(colon + 1);
      const storyPath = `battle.story.axes.${axisKey}`;
      const storyLabel = t(storyPath);
      const label = storyLabel !== storyPath ? storyLabel : axisLabel(t, axisKey);
      return hero ? t('battle.explain.axisHero', { axis: label, hero }) : label;
    });
  return joinAnd(t, parts);
}

function formatTagList(t: TFunction, spec: string): string {
  return joinAnd(
    t,
    spec
      .split('|')
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => customTagName(t, name)),
  );
}

function formatNameList(t: TFunction, spec: string): string {
  return joinAnd(
    t,
    spec
      .split('|')
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

function formatHeroRoleList(t: TFunction, spec: string): string {
  if (!spec.includes(':')) return spec;
  return joinAnd(
    t,
    spec
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const colon = part.indexOf(':');
        const name = colon === -1 ? part : part.slice(0, colon);
        const role = colon === -1 ? '' : part.slice(colon + 1);
        if (!role) return name;
        return t('eval.axis.heroRole', { name, role: assignedRoleLabel(t, role) });
      }),
  );
}

function sidePhrase(t: TFunction, side: string, form: 'subject' | 'object'): string {
  const path = `battle.explain.side.${side}.${form}`;
  const translated = t(path);
  return translated !== path ? translated : side;
}

function edgePhrase(t: TFunction, edge: string): string {
  const path = `battle.explain.edge.${edge}`;
  const translated = t(path);
  return translated !== path ? translated : edge;
}

function translateBag(t: TFunction, key: string, params: Record<string, string>): Record<string, string> {
  const bag: Record<string, string> = { ...params };

  if (bag.axis) {
    const storyPath = `battle.story.axes.${bag.axis}`;
    const storyLabel = t(storyPath);
    bag.axis = storyLabel !== storyPath ? storyLabel : axisLabel(t, bag.axis);
  }
  if (bag.confidence) {
    const tierPath = `battle.tier.${bag.confidence}`;
    const tier = t(tierPath);
    bag.confidence = tier !== tierPath ? tier : bag.confidence;
  }
  if (bag.lane) {
    const lanePath = `battle.story.laneFull.${bag.lane}`;
    const lane = t(lanePath);
    bag.lane = lane !== lanePath ? lane : bag.lane;
  }
  if (bag.threat) {
    const threatPath = `eval.counter.threat.${bag.threat}`;
    const threat = t(threatPath);
    bag.threat = threat !== threatPath ? threat : bag.threat.replace(/_/g, ' ');
  }
  if (bag.tagA) {
    const path = `eval.synergy.tag.${bag.tagA}`;
    const tag = t(path);
    bag.tagA = tag !== path ? tag : bag.tagA.replace(/_/g, ' ');
  }
  if (bag.tagB) {
    const path = `eval.synergy.tag.${bag.tagB}`;
    const tag = t(path);
    bag.tagB = tag !== path ? tag : bag.tagB.replace(/_/g, ' ');
  }
  if (bag.band) {
    const path = `eval.summary.band.${bag.band}`;
    const band = t(path, { pct: bag.pct });
    bag.bandLabel = band !== path ? band : bag.band;
  }

  if (key === 'eval.axis.roleFit' && params.heroes) {
    bag.heroes = formatHeroRoleList(t, params.heroes);
  }

  if (key === 'eval.summary.axisLine') {
    bag.axis = axisLabel(t, params.axis);
    if (params.scale === 'score') {
      bag.bandLabel = t('eval.summary.score', { pct: params.pct });
    } else {
      bag.bandLabel = t(`eval.summary.band.${params.band}`, { pct: params.pct });
    }
  }

  if (key.startsWith('battle.explain.sheet.')) {
    if (bag.yours) bag.yours = formatAxisHeroList(t, params.yours);
    if (bag.hole) bag.hole = formatAxisHeroList(t, params.hole);
    if (bag.theirs) bag.theirs = formatAxisHeroList(t, params.theirs);
  }

  if (key.startsWith('battle.explain.tags.')) {
    if (bag.mine) bag.mine = formatTagList(t, params.mine);
    if (bag.theirs) bag.theirs = formatTagList(t, params.theirs);
    if (bag.tags) bag.tags = formatTagList(t, params.tags);
  }

  if (key.startsWith('battle.explain.shutdown.')) {
    if (bag.names) bag.names = formatNameList(t, params.names);
  }

  if (key === 'battle.explain.frame.even' || key === 'battle.explain.frame.ahead') {
    bag.edgePhrase = edgePhrase(t, params.edge);
    if (params.side) bag.side = sidePhrase(t, params.side, 'subject');
  }

  if (key === 'battle.explain.clock.split') {
    bag.faster = sidePhrase(t, params.faster, 'subject');
    bag.scaler = sidePhrase(t, params.scaler, 'object');
  }

  for (const field of ['winner', 'loser', 'underdog', 'perspective'] as const) {
    if (bag[field] === 'yours' || bag[field] === 'opponent') {
      bag[field] = sidePhrase(
        t,
        bag[field],
        field === 'perspective' || field === 'underdog' ? 'object' : 'object',
      );
    }
  }

  if (key === 'battle.explain.upset.reasons') {
    bag.lead = t(`battle.explain.upset.lead.${params.lead}`);
    bag.underdog = sidePhrase(t, params.underdog, 'object');
    const reasons: string[] = [];
    if (params.matchupHero) {
      reasons.push(
        t('battle.explain.upset.matchup', {
          hero: params.matchupHero,
          vs: params.matchupVs,
          underdog: bag.underdog,
        }),
      );
    }
    if (params.comboA) {
      reasons.push(
        t('battle.explain.upset.synergy', {
          heroA: params.comboA,
          heroB: params.comboB,
          underdog: bag.underdog,
        }),
      );
    }
    if (params.axis) {
      const storyPath = `battle.story.axes.${params.axis}`;
      const storyLabel = t(storyPath);
      const axis = storyLabel !== storyPath ? storyLabel : axisLabel(t, params.axis);
      reasons.push(t('battle.explain.upset.axis', { underdog: bag.underdog, axis }));
    }
    bag.reasons = reasons.join('; ');
  }

  if (key === 'eval.pro.match') {
    bag.byTeam = params.teamName ? t('eval.pro.byTeam', { teamName: params.teamName }) : '';
    bag.league = params.leagueName ? t('eval.pro.league', { leagueName: params.leagueName }) : '';
  }

  if (key === 'eval.gameplan.leanOnOther' || key === 'eval.gameplan.coverForOther') {
    const { detailKey, ...rest } = params;
    const prefixKey = key === 'eval.gameplan.leanOnOther' ? 'eval.gameplan.leanOn' : 'eval.gameplan.coverFor';
    bag.narrative = detailKey ? t(detailKey, rest) : '';
    bag.prefixKey = prefixKey;
  }

  return bag;
}

function appendDampened(t: TFunction, key: string, params: Record<string, string>, text: string): string {
  if (key.startsWith('eval.synergy.pair.') && params.dampened === '1') {
    return `${text}${t('eval.synergy.dampened')}`;
  }
  return text;
}

/**
 * Render a server LocalizedLine through client i18n. Plain strings (legacy
 * History snapshots) pass through unchanged.
 */
export function renderLocalizedLine(t: TFunction, line: LocalizedLine): string {
  if (typeof line === 'string') return line;
  if (!isI18nLine(line)) return '';

  const params = line.params ?? {};

  if (NARRATIVE_KEYS.has(line.key) && isNarrativeParams(params)) {
    const narrative = composeAxisNarrative(t, params);
    if (line.key === 'eval.axis.narrative') return narrative;
    return t(line.key, { narrative });
  }

  if (line.key === 'eval.gameplan.leanOnOther' || line.key === 'eval.gameplan.coverForOther') {
    const bag = translateBag(t, line.key, params);
    const prefixKey = bag.prefixKey || 'eval.gameplan.leanOn';
    return t(prefixKey, { narrative: bag.narrative });
  }

  const bag = translateBag(t, line.key, params);
  const translated = t(line.key, {
    ...bag,
    count: params.count != null && params.count !== '' ? Number(params.count) : undefined,
  });
  return appendDampened(t, line.key, params, translated);
}

export function renderLocalizedLines(t: TFunction, lines: LocalizedLine[] | string): string {
  if (typeof lines === 'string') return renderLocalizedLine(t, lines);
  return lines.map((line) => renderLocalizedLine(t, line)).join(' ');
}
