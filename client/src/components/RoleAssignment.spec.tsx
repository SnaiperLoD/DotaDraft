import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ROLES } from 'shared';
import RoleAssignment from './RoleAssignment';
import { draftHeroView, fiveDraftHeroes, minimalHero } from '../test/fixtures/draft';

function heroCard(heroName: string): HTMLElement {
  const nameEl = screen.getByText(heroName, { selector: '.hero-name' });
  const card = nameEl.closest('.role-assignment-card');
  if (!(card instanceof HTMLElement)) throw new Error(`Role card not found for ${heroName}`);
  return card;
}

function roleCell(heroName: string, role: string): HTMLElement {
  const cell = within(heroCard(heroName))
    .getAllByTestId('role-cell')
    .find((el) => el.getAttribute('data-role') === role);
  if (!cell) throw new Error(`role-cell ${role} not found for ${heroName}`);
  return cell;
}

describe('RoleAssignment', () => {
  it('keeps confirm-roles disabled when five heroes have no roles', () => {
    render(<RoleAssignment heroes={fiveDraftHeroes()} onSubmit={vi.fn()} />);
    expect(screen.getAllByTestId('role-cell')).toHaveLength(25);
    expect(screen.getByTestId('confirm-roles')).toBeDisabled();
  });

  it('enables confirm after all five roles and submits in heroes order', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const heroes = fiveDraftHeroes();
    render(<RoleAssignment heroes={heroes} onSubmit={onSubmit} />);

    for (let i = 0; i < heroes.length; i++) {
      await user.click(roleCell(heroes[i].hero.name, ROLES[i]));
    }

    const confirm = screen.getByTestId('confirm-roles');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(heroes.map((h, i) => ({ heroId: h.heroId, role: ROLES[i] })));
  });

  it('steals Mid from A when B takes Mid; submit has Mid only on B', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const heroes = fiveDraftHeroes();
    const [heroA, heroB, heroC, heroD, heroE] = heroes;
    render(<RoleAssignment heroes={heroes} onSubmit={onSubmit} />);

    await user.click(roleCell(heroA.hero.name, 'Mid'));
    await user.click(roleCell(heroB.hero.name, 'Mid'));

    expect(roleCell(heroA.hero.name, 'Mid')).toHaveAttribute('aria-pressed', 'false');
    expect(heroCard(heroA.hero.name)).not.toHaveClass('is-assigned');
    expect(roleCell(heroB.hero.name, 'Mid')).toHaveAttribute('aria-pressed', 'true');

    await user.click(roleCell(heroA.hero.name, 'Carry'));
    await user.click(roleCell(heroC.hero.name, 'Offlane'));
    await user.click(roleCell(heroD.hero.name, 'Soft Support'));
    await user.click(roleCell(heroE.hero.name, 'Hard Support'));
    await user.click(screen.getByTestId('confirm-roles'));

    expect(onSubmit).toHaveBeenCalledWith([
      { heroId: heroA.heroId, role: 'Carry' },
      { heroId: heroB.heroId, role: 'Mid' },
      { heroId: heroC.heroId, role: 'Offlane' },
      { heroId: heroD.heroId, role: 'Soft Support' },
      { heroId: heroE.heroId, role: 'Hard Support' },
    ]);
    const midAssignments = onSubmit.mock.calls[0][0].filter(
      (row: { heroId: number; role: string }) => row.role === 'Mid',
    );
    expect(midAssignments).toEqual([{ heroId: heroB.heroId, role: 'Mid' }]);
  });

  it('disables confirm while submitting even after every role is set', async () => {
    const user = userEvent.setup();
    const heroes = fiveDraftHeroes();
    render(<RoleAssignment heroes={heroes} onSubmit={vi.fn()} submitting />);

    for (let i = 0; i < heroes.length; i++) {
      await user.click(roleCell(heroes[i].hero.name, ROLES[i]));
    }

    expect(screen.getByTestId('confirm-roles')).toBeDisabled();
  });

  it('marks Soft and Hard Support as recommended when presumed Support share is set', () => {
    const supportHero = draftHeroView({
      heroId: 1,
      name: 'Crystal Maiden',
      pickOrder: 1,
      hero: minimalHero({
        id: 1,
        name: 'Crystal Maiden',
        presumed_positions: [{ position: 'Support', share: 0.82 }],
      }),
    });
    render(<RoleAssignment heroes={[supportHero]} onSubmit={vi.fn()} />);

    expect(roleCell('Crystal Maiden', 'Soft Support')).toHaveClass('is-recommended');
    expect(roleCell('Crystal Maiden', 'Hard Support')).toHaveClass('is-recommended');
    expect(roleCell('Crystal Maiden', 'Carry')).not.toHaveClass('is-recommended');
  });
});
