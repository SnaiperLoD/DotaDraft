import { matchHeroName, parseCopiedDraft, resolveCopiedDraft } from 'shared';

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
  });
});

describe('matchHeroName', () => {
  it('ignores apostrophes and case', () => {
    expect(matchHeroName("Nature's Prophet", 'natures prophet')).toBe(true);
    expect(matchHeroName('Anti-Mage', 'anti mage')).toBe(true);
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
  });
});
