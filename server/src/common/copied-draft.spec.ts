import {
  decodeCopiedDraft,
  encodeCopiedDraft,
  matchHeroName,
  parseCopiedDraft,
  resolveCopiedDraft,
  sameHeroSet,
  sanitizeDraftCodeInput,
} from '../../shared-src/utils/copiedDraft'; // path Stryker --findRelatedTests can see

/** Bit-pack like encodeCopiedDraft without role/range checks — for illegal id codes. */
function encodeUnchecked(ids: number[]): string {
  const alph = '0123456789abcdefghjkmnpqrstvwxyz';
  let bits = 0n;
  for (const id of ids) bits = (bits << 12n) | BigInt(id);
  const chars: string[] = [];
  let rest = bits;
  for (let i = 0; i < 12; i++) {
    chars.push(alph[Number(rest & 31n)]);
    rest >>= 5n;
  }
  chars.reverse();
  let check = 0;
  for (const id of ids) check ^= id;
  return `dd1${chars.join('')}${alph[check & 31]}`;
}

describe('parseCopiedDraft', () => {
  it('parses English Copy Draft lines into the five roles', () => {
    const text = [
      'Carry: Anti-Mage',
      'Mid: Invoker',
      'Offlane: Axe',
      'Soft Support: Crystal Maiden',
      'Hard Support: Witch Doctor',
    ].join('\n');
    expect(parseCopiedDraft(text)).toEqual([
      { role: 'Carry', heroName: 'Anti-Mage' },
      { role: 'Mid', heroName: 'Invoker' },
      { role: 'Offlane', heroName: 'Axe' },
      { role: 'Soft Support', heroName: 'Crystal Maiden' },
      { role: 'Hard Support', heroName: 'Witch Doctor' },
    ]);
  });

  it('parses Russian role labels from the in-app copy button', () => {
    const text = [
      'Керри: Anti-Mage',
      'Мид: Invoker',
      'Оффлейн: Axe',
      'Софт-саппорт: CM',
      'Хард-саппорт: WD',
    ].join('\n');
    expect(parseCopiedDraft(text).map((r) => r.role)).toEqual([
      'Carry',
      'Mid',
      'Offlane',
      'Soft Support',
      'Hard Support',
    ]);
  });

  it('skips junk lines that are not Role: Hero', () => {
    expect(parseCopiedDraft('hello\nCarry: Axe\n')).toEqual([{ role: 'Carry', heroName: 'Axe' }]);
    expect(parseCopiedDraft('prefix Carry: Axe')).toEqual([]);
    expect(parseCopiedDraft('Nope: Axe')).toEqual([]);
  });

  it('accepts hyphen/space aliases, trims fields, and allows no space after the colon', () => {
    expect(parseCopiedDraft('  Carry:Axe  ')).toEqual([{ role: 'Carry', heroName: 'Axe' }]);
    expect(parseCopiedDraft('Carry: Axe  ')).toEqual([{ role: 'Carry', heroName: 'Axe' }]);
    expect(parseCopiedDraft('Carry : Axe')).toEqual([{ role: 'Carry', heroName: 'Axe' }]);
    expect(
      parseCopiedDraft(
        ['soft-support: CM', 'софт саппорт: WD', 'hard-support: Lion', 'хард саппорт: CM'].join('\n'),
      ).map((r) => r.role),
    ).toEqual(['Soft Support', 'Soft Support', 'Hard Support', 'Hard Support']);
  });
});

describe('matchHeroName', () => {
  it('ignores apostrophes and case', () => {
    expect(matchHeroName("Nature's Prophet", 'natures prophet')).toBe(true);
    expect(matchHeroName('Anti-Mage', 'anti mage')).toBe(true);
    expect(matchHeroName('Anti-Mage', 'anti--mage')).toBe(true);
    expect(matchHeroName('Anti-Mage', 'AntiMage')).toBe(false);
    expect(matchHeroName('Axe', 'Axe  ')).toBe(true);
    expect(matchHeroName('Axe', 'Invoker')).toBe(false);
  });
});

describe('resolveCopiedDraft', () => {
  const roster = [
    { id: 1, name: 'Anti-Mage' },
    { id: 2, name: 'Invoker' },
    { id: 3, name: 'Axe' },
    { id: 4, name: 'Crystal Maiden' },
    { id: 5, name: 'Witch Doctor' },
    { id: 6, name: "Nature's Prophet" },
  ];

  const fiveLines = [
    'Carry: Anti-Mage',
    'Mid: Invoker',
    'Offlane: Axe',
    'Soft Support: Crystal Maiden',
    'Hard Support: Witch Doctor',
  ].join('\n');

  it('resolves five roles to ids in paste order', () => {
    expect(resolveCopiedDraft(fiveLines, roster)).toEqual({
      heroIds: [1, 2, 3, 4, 5],
      heroRoles: [
        { heroId: 1, role: 'Carry' },
        { heroId: 2, role: 'Mid' },
        { heroId: 3, role: 'Offlane' },
        { heroId: 4, role: 'Soft Support' },
        { heroId: 5, role: 'Hard Support' },
      ],
    });
  });

  it('accepts apostrophe-insensitive names', () => {
    const paste = [
      'Carry: natures prophet',
      'Mid: Invoker',
      'Offlane: Axe',
      'Soft Support: Crystal Maiden',
      'Hard Support: Witch Doctor',
    ].join('\n');
    expect(resolveCopiedDraft(paste, roster).heroIds[0]).toBe(6);
  });

  it('rejects a short paste, duplicate roles, unknown heroes, and duplicate heroes', () => {
    expect(() => resolveCopiedDraft('Carry: Axe\nMid: Invoker', roster)).toThrow(
      'Copied draft must list all 5 roles as Role: Hero',
    );
    expect(() =>
      resolveCopiedDraft(
        [
          'Carry: Axe',
          'Carry: Invoker',
          'Mid: Anti-Mage',
          'Offlane: Crystal Maiden',
          'Soft Support: Witch Doctor',
        ].join('\n'),
        roster,
      ),
    ).toThrow('duplicate or missing roles');
    expect(() => resolveCopiedDraft(fiveLines.replace('Axe', 'Not A Hero'), roster)).toThrow('Unknown hero');
    expect(() => resolveCopiedDraft(fiveLines.replace('Invoker', 'Axe'), roster)).toThrow('duplicate heroes');
    expect(() => resolveCopiedDraft('hello there', roster)).toThrow(
      'Copied draft must list all 5 roles as Role: Hero',
    );
  });

  it('round-trips a short draft code and ignores spaces/dashes', () => {
    const heroRoles = [
      { heroId: 1, role: 'Carry' },
      { heroId: 2, role: 'Mid' },
      { heroId: 3, role: 'Offlane' },
      { heroId: 4, role: 'Soft Support' },
      { heroId: 5, role: 'Hard Support' },
    ];
    const code = encodeCopiedDraft(heroRoles);
    expect(code).toMatch(/^dd1[0-9a-hjkmnp-tv-z]{13}$/);
    expect(code.length).toBeLessThan(20);
    expect(decodeCopiedDraft(code)).toEqual({
      heroIds: [1, 2, 3, 4, 5],
      heroRoles,
    });
    expect(resolveCopiedDraft(` ${code.slice(0, 8)}-${code.slice(8)} `, roster)).toEqual({
      heroIds: [1, 2, 3, 4, 5],
      heroRoles,
    });
  });

  it('rejects a tampered or truncated draft code', () => {
    const code = encodeCopiedDraft([
      { heroId: 1, role: 'Carry' },
      { heroId: 2, role: 'Mid' },
      { heroId: 3, role: 'Offlane' },
      { heroId: 4, role: 'Soft Support' },
      { heroId: 5, role: 'Hard Support' },
    ]);
    const flipped = `${code.slice(0, -1)}${code.endsWith('0') ? '1' : '0'}`;
    expect(decodeCopiedDraft(flipped)).toBeNull();
    expect(() => resolveCopiedDraft(flipped, roster)).toThrow('Invalid draft code');
    expect(() => resolveCopiedDraft('dd1notacode!!!!', roster)).toThrow('Invalid draft code');
    expect(decodeCopiedDraft(`${code}x`)).toBeNull();
    expect(decodeCopiedDraft(`${code.slice(0, 8)}i${code.slice(9)}`)).toBeNull();
    expect(decodeCopiedDraft(encodeUnchecked([0, 2, 3, 4, 5]))).toBeNull();
    expect(decodeCopiedDraft(encodeUnchecked([1, 1, 3, 4, 5]))).toBeNull();
    const missingFromRoster = encodeCopiedDraft([
      { heroId: 1, role: 'Carry' },
      { heroId: 2, role: 'Mid' },
      { heroId: 3, role: 'Offlane' },
      { heroId: 4, role: 'Soft Support' },
      { heroId: 6, role: 'Hard Support' },
    ]);
    expect(() =>
      resolveCopiedDraft(
        missingFromRoster,
        roster.filter((h) => h.id !== 6),
      ),
    ).toThrow('Unknown hero: 6');
  });

  it('encodes by role order, not array order', () => {
    const byRole = [
      { heroId: 1, role: 'Carry' },
      { heroId: 2, role: 'Mid' },
      { heroId: 3, role: 'Offlane' },
      { heroId: 4, role: 'Soft Support' },
      { heroId: 5, role: 'Hard Support' },
    ];
    const shuffled = [
      { heroId: 5, role: 'Hard Support' },
      { heroId: 3, role: 'Offlane' },
      { heroId: 1, role: 'Carry' },
      { heroId: 4, role: 'Soft Support' },
      { heroId: 2, role: 'Mid' },
    ];
    expect(encodeCopiedDraft(shuffled)).toBe(encodeCopiedDraft(byRole));
  });

  it('rejects missing roles, duplicate heroes, and out-of-range ids', () => {
    expect(() =>
      encodeCopiedDraft([
        { heroId: 1, role: 'Carry' },
        { heroId: 2, role: 'Mid' },
        { heroId: 3, role: 'Offlane' },
        { heroId: 4, role: 'Soft Support' },
      ]),
    ).toThrow('Copied draft must list all 5 roles');
    expect(() =>
      encodeCopiedDraft([
        { heroId: 1, role: 'Carry' },
        { heroId: 1, role: 'Mid' },
        { heroId: 3, role: 'Offlane' },
        { heroId: 4, role: 'Soft Support' },
        { heroId: 5, role: 'Hard Support' },
      ]),
    ).toThrow('Copied draft has duplicate heroes');
    expect(() =>
      encodeCopiedDraft([
        { heroId: 0, role: 'Carry' },
        { heroId: 2, role: 'Mid' },
        { heroId: 3, role: 'Offlane' },
        { heroId: 4, role: 'Soft Support' },
        { heroId: 5, role: 'Hard Support' },
      ]),
    ).toThrow('Invalid hero id');
    expect(() =>
      encodeCopiedDraft([
        { heroId: 4096, role: 'Carry' },
        { heroId: 2, role: 'Mid' },
        { heroId: 3, role: 'Offlane' },
        { heroId: 4, role: 'Soft Support' },
        { heroId: 5, role: 'Hard Support' },
      ]),
    ).toThrow('Invalid hero id');
    expect(
      encodeCopiedDraft([
        { heroId: 4095, role: 'Carry' },
        { heroId: 2, role: 'Mid' },
        { heroId: 3, role: 'Offlane' },
        { heroId: 4, role: 'Soft Support' },
        { heroId: 5, role: 'Hard Support' },
      ]),
    ).toMatch(/^dd1/);
  });

  it('rejects a dd2 prefix and an unknown checksum', () => {
    const code = encodeCopiedDraft([
      { heroId: 1, role: 'Carry' },
      { heroId: 2, role: 'Mid' },
      { heroId: 3, role: 'Offlane' },
      { heroId: 4, role: 'Soft Support' },
      { heroId: 5, role: 'Hard Support' },
    ]);
    expect(decodeCopiedDraft(`dd2${code.slice(3)}`)).toBeNull();
    const badCheck = code.endsWith('a') ? 'b' : 'a';
    expect(decodeCopiedDraft(`${code.slice(0, -1)}${badCheck}`)).toBeNull();
  });
});

describe('sameHeroSet', () => {
  it('is order-independent for exactly five ids', () => {
    expect(sameHeroSet([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])).toBe(true);
    expect(sameHeroSet([5, 4, 3, 2, 1], [1, 2, 3, 4, 5])).toBe(true);
    expect(sameHeroSet([1, 2, 3, 4, 5], [1, 2, 3, 4, 6])).toBe(false);
    expect(sameHeroSet([1, 2, 3, 4], [1, 2, 3, 4])).toBe(false);
    expect(sameHeroSet([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6])).toBe(false);
    expect(sameHeroSet([1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6])).toBe(false);
    expect(sameHeroSet([1, 2, 3, 4], [1, 2, 3, 4, 5])).toBe(false);
    expect(sameHeroSet([1, 2, 3, 4, 5], [1, 2, 3, 4])).toBe(false);
    expect(sameHeroSet([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5])).toBe(false);
    expect(sameHeroSet([], [])).toBe(false);
  });
});

describe('sanitizeDraftCodeInput', () => {
  it('maps Crockford lookalikes, strips markup, and caps length', () => {
    expect(sanitizeDraftCodeInput('ILO')).toBe('110');
    expect(sanitizeDraftCodeInput('<script>alert(1)</script>')).not.toMatch(/[<>]/);
    expect(sanitizeDraftCodeInput('<script>alert(1)</script>')).toBe('scr1pta1ert1scr1pt');
    expect(sanitizeDraftCodeInput('a'.repeat(40)).length).toBe(24);
  });
});
