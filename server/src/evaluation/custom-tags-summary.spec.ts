import { activeCustomTagsForTeam } from 'shared';

// Blueprint/10-tech-debt-backlog.md, "Новая категория Custom Tags в
// Evaluation breakdown" — activeCustomTagsForTeam (shared/customTags.ts)
// is what evaluation.service.ts calls to build EvaluationResult.customTags.
// Tested here rather than in shared/ (no test infra there — this project's
// convention is to test shared logic from the server suite that actually
// consumes it, see shared's own lack of a jest config).
describe('activeCustomTagsForTeam', () => {
  it('includes an always-visible tag for a solo carrier', () => {
    const active = activeCustomTagsForTeam(['Chaos Knight', 'Sniper', 'Lion', 'Rubick', 'Pudge']);
    expect(active.map((t) => t.name)).toContain('The Fundamentals');
  });

  it('excludes a revealable tag when the team is below its reveal threshold', () => {
    const active = activeCustomTagsForTeam(['Silencer', 'Sniper', 'Lion', 'Rubick', 'Bloodseeker']);
    expect(active.map((t) => t.name)).not.toContain('Statstealer');
  });

  it('includes a revealable tag once the team clears its reveal threshold', () => {
    const active = activeCustomTagsForTeam(['Silencer', 'Slark', 'Lion', 'Rubick', 'Sniper']);
    expect(active.map((t) => t.name)).toContain('Statstealer');
  });

  it('de-duplicates a tag with multiple carriers into a single entry', () => {
    const active = activeCustomTagsForTeam(['Silencer', 'Slark', 'Pudge', 'Rubick', 'Sniper']);
    expect(active.filter((t) => t.name === 'Statstealer')).toHaveLength(1);
  });

  it('returns an empty list for a team with no active tags', () => {
    const active = activeCustomTagsForTeam(['Sniper', 'Lion', 'Rubick', 'Bloodseeker', 'Axe']);
    expect(active).toEqual([]);
  });

  it('hides divergence-fix calibration tags even for a solo carrier', () => {
    const active = activeCustomTagsForTeam([
      'Phantom Assassin',
      'Disruptor',
      'Spectre',
      'Lina',
      'Crystal Maiden',
    ]);
    const names = active.map((t) => t.name);
    expect(names).not.toContain('Raid Boss');
    expect(names).not.toContain('Disable Battery');
    expect(names).not.toContain('Haunt Absolute');
    expect(names).not.toContain('Siege Voltage');
  });

  // Blueprint/10-tech-debt-backlog.md, "Active Combos: динамический текст
  // магнитуды для count-based тегов" — by direct user request, found while
  // investigating the Mass Buffer bug: the static description explained the
  // formula but never showed the actual number for a given draft.
  describe('dynamic description text for count-dependent tags', () => {
    it('substitutes the actual per-hero and combined Mass Buffer magnitude for 1 carrier', () => {
      const active = activeCustomTagsForTeam(['Vengeful Spirit', 'Sniper', 'Lion', 'Rubick', 'Axe']);
      const massBuffer = active.find((t) => t.name === 'Mass Buffer')!;
      expect(massBuffer.description).toContain('1 Mass Buffer hero');
      expect(massBuffer.description).toContain('+3% team teamfight/burst each');
      expect(massBuffer.description).toContain('+3% combined');
    });

    it('substitutes the grown per-hero and combined Mass Buffer magnitude for 3 carriers', () => {
      const active = activeCustomTagsForTeam(['Vengeful Spirit', 'Mirana', 'Luna', 'Rubick', 'Axe']);
      const massBuffer = active.find((t) => t.name === 'Mass Buffer')!;
      expect(massBuffer.description).toContain('3 Mass Buffer heroes');
      expect(massBuffer.description).toContain('+5% team teamfight/burst each');
      expect(massBuffer.description).toContain('+15% combined');
    });

    it('omits the stacking-penalty clause for a solo Unseen carrier', () => {
      const active = activeCustomTagsForTeam(['Riki', 'Sniper', 'Lion', 'Rubick', 'Axe']);
      const unseen = active.find((t) => t.name === 'Unseen')!;
      expect(unseen.description).not.toMatch(/durability\/teamfight/);
    });

    it('adds the count-scaled stacking penalty once 2+ Unseen heroes are on the team', () => {
      const active = activeCustomTagsForTeam(['Riki', 'Weaver', 'Lion', 'Rubick', 'Axe']);
      const unseen = active.find((t) => t.name === 'Unseen')!;
      expect(unseen.description).toContain('2 on this team: -5% durability/teamfight each');
    });

    it('scales the Army of Clones stacking penalty text with a 3rd carrier', () => {
      const active = activeCustomTagsForTeam(['Phantom Lancer', 'Terrorblade', 'Naga Siren', 'Rubick', 'Axe']);
      const armyOfClones = active.find((t) => t.name === 'Army of Clones')!;
      expect(armyOfClones.description).toContain('3 on this team: -10% durability/teamfight each');
    });

    // No solo-carrier test here: Statstealer is revealable with
    // minCountToReveal=2 (shared/customTags.ts), so a lone carrier never
    // clears activeCustomTagsForTeam's reveal gate in the first place —
    // describeActiveTag's solo-case text exists for correctness (it
    // matches the real +2% solo Battle Engine bonus) but isn't reachable
    // through this specific entry point, only the 2+ case is.
    it('describes the Statstealer 2+ case with the actual carrier count', () => {
      const active = activeCustomTagsForTeam(['Silencer', 'Slark', 'Pudge', 'Rubick', 'Sniper']);
      const statstealer = active.find((t) => t.name === 'Statstealer')!;
      expect(statstealer.description).toContain('3 on this team');
    });

    it('keeps solo Fundamentals generic until Eval fills named axes', () => {
      const active = activeCustomTagsForTeam(['Io', 'Axe', 'Sniper', 'Rubick', 'Pudge']);
      const fundamentals = active.find((t) => t.name === 'The Fundamentals')!;
      expect(fundamentals.description).toContain('2+ Fundamentals');
    });
  });
});
