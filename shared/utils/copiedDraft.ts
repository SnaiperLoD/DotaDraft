import { ROLES } from '../constants/roles';

export type CopiedHeroRole = { heroId: number; role: string };

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

const CODE_ALPH = '0123456789abcdefghjkmnpqrstvwxyz';
const CODE_PREFIX = 'dd1';
const HERO_BITS = 12;
const HERO_MAX = (1 << HERO_BITS) - 1;

function rolesInOrder(heroRoles: CopiedHeroRole[]): number[] {
  const ids = ROLES.map((role) => {
    const row = heroRoles.find((r) => r.role === role);
    if (!row) throw new Error('Copied draft must list all 5 roles');
    if (!Number.isInteger(row.heroId) || row.heroId < 1 || row.heroId > HERO_MAX) {
      throw new Error('Invalid hero id');
    }
    return row.heroId;
  });
  if (new Set(ids).size !== 5) throw new Error('Copied draft has duplicate heroes');
  return ids;
}

function normalizeDraftCode(text: string): string {
  return text.trim().toLowerCase().replace(/[\s-]/g, '');
}

export function encodeCopiedDraft(heroRoles: CopiedHeroRole[]): string {
  const ids = rolesInOrder(heroRoles);
  let bits = 0n;
  for (const id of ids) bits = (bits << BigInt(HERO_BITS)) | BigInt(id);
  const chars: string[] = [];
  let rest = bits;
  for (let i = 0; i < 12; i++) {
    chars.push(CODE_ALPH[Number(rest & 31n)]);
    rest >>= 5n;
  }
  chars.reverse();
  let check = 0;
  for (const id of ids) check ^= id;
  return `${CODE_PREFIX}${chars.join('')}${CODE_ALPH[check & 31]}`;
}

export function decodeCopiedDraft(text: string): { heroIds: number[]; heroRoles: CopiedHeroRole[] } | null {
  const raw = normalizeDraftCode(text);
  const body = raw.startsWith(CODE_PREFIX) ? raw.slice(CODE_PREFIX.length) : '';
  if (body.length !== 13) return null;
  const payload = body.slice(0, 12);
  const checkChar = body[12];
  if (![...payload, checkChar].every((ch) => CODE_ALPH.includes(ch))) return null;
  let bits = 0n;
  for (const ch of payload) bits = (bits << 5n) | BigInt(CODE_ALPH.indexOf(ch));
  const ids: number[] = [];
  let rest = bits;
  for (let i = 0; i < 5; i++) {
    ids.push(Number(rest & BigInt(HERO_MAX)));
    rest >>= BigInt(HERO_BITS);
  }
  ids.reverse();
  let check = 0;
  for (const id of ids) check ^= id;
  if (CODE_ALPH[check & 31] !== checkChar) return null;
  if (ids.some((id) => id < 1) || new Set(ids).size !== 5) return null;
  return {
    heroIds: ids,
    heroRoles: ids.map((heroId, i) => ({ heroId, role: ROLES[i] })),
  };
}

function looksLikeDraftCode(text: string): boolean {
  const raw = normalizeDraftCode(text);
  return raw.startsWith(CODE_PREFIX) && !text.includes(':');
}

/** Same five heroes, order-independent. Challenge-vs-self uses this. */
export function sameHeroSet(a: number[], b: number[]): boolean {
  if (a.length !== 5 || b.length !== 5) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((id, i) => id === right[i]);
}

/**
 * Challenge paste is a short draft code, not free text. Strip anything that
 * isn't Crockford-base32 / separators so a paste can't blow the row or smuggle
 * markup. I/L → 1, O → 0 (Crockford).
 */
export function sanitizeDraftCodeInput(raw: string): string {
  const mapped = raw.replace(/[iloILO]/g, (ch) => {
    const c = ch.toLowerCase();
    if (c === 'i' || c === 'l') return '1';
    if (c === 'o') return '0';
    return ch;
  });
  return mapped.replace(/[^0-9a-hjkmnp-tv-zA-Z\s-]/g, '').slice(0, 24);
}

export function resolveCopiedDraft(
  text: string,
  roster: { id: number; name: string }[],
): { heroIds: number[]; heroRoles: CopiedHeroRole[] } {
  const decoded = decodeCopiedDraft(text);
  if (decoded) {
    for (const id of decoded.heroIds) {
      if (!roster.some((h) => h.id === id)) {
        throw new Error(`Unknown hero: ${id}`);
      }
    }
    return decoded;
  }
  if (looksLikeDraftCode(text)) {
    throw new Error('Invalid draft code');
  }
  const rows = parseCopiedDraft(text);
  if (rows.length !== 5) {
    throw new Error('Copied draft must list all 5 roles as Role: Hero');
  }
  const roles = new Set(rows.map((r) => r.role));
  if (roles.size !== 5) {
    throw new Error('Copied draft has duplicate or missing roles');
  }
  const heroIds: number[] = [];
  const heroRoles: CopiedHeroRole[] = [];
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
