import { ROLES } from '../constants/roles';

const ROLE_ALIASES: Record<string, (typeof ROLES)[number]> = {
  carry: 'Carry',
  керри: 'Carry',
  mid: 'Mid',
  мид: 'Mid',
  offlane: 'Offlane',
  оффлейн: 'Offlane',
  'soft support': 'Soft Support',
  'soft-support': 'Soft Support',
  'софт-саппорт': 'Soft Support',
  'софт саппорт': 'Soft Support',
  'hard support': 'Hard Support',
  'hard-support': 'Hard Support',
  'хард-саппорт': 'Hard Support',
  'хард саппорт': 'Hard Support',
};

export function normalizeHeroName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''`´]/g, '')
    .replace(/[^a-z0-9а-яё]+/gi, ' ')
    .trim();
}

export function matchHeroName(rosterName: string, pasted: string): boolean {
  return normalizeHeroName(rosterName) === normalizeHeroName(pasted);
}

export function parseCopiedDraft(text: string): { role: string; heroName: string }[] {
  const rows: { role: string; heroName: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^(.+?):\s*(.+)$/);
    if (!match) continue;
    const role = ROLE_ALIASES[match[1].trim().toLowerCase()];
    if (!role) continue;
    rows.push({ role, heroName: match[2].trim() });
  }
  return rows;
}

export function resolveCopiedDraft(
  text: string,
  roster: { id: number; name: string }[],
): { heroIds: number[]; heroRoles: { heroId: number; role: string }[] } {
  const rows = parseCopiedDraft(text);
  if (rows.length !== 5) {
    throw new Error('Copied draft must list all 5 roles as Role: Hero');
  }
  const roles = new Set(rows.map((r) => r.role));
  if (roles.size !== 5) {
    throw new Error('Copied draft has duplicate or missing roles');
  }
  const heroIds: number[] = [];
  const heroRoles: { heroId: number; role: string }[] = [];
  for (const row of rows) {
    const hero = roster.find((h) => matchHeroName(h.name, row.heroName));
    if (!hero) {
      throw new Error(`Unknown hero: ${row.heroName}`);
    }
    if (heroIds.includes(hero.id)) {
      throw new Error('Copied draft has duplicate heroes');
    }
    heroIds.push(hero.id);
    heroRoles.push({ heroId: hero.id, role: row.role });
  }
  return { heroIds, heroRoles };
}
