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
});
