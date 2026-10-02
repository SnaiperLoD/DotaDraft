import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BattleLaneResult } from 'shared';
import { ConfidenceNote, LaneMatchups } from './BattlePanel';
import en from '../locales/en.json';
import ru from '../locales/ru.json';

function lane(id: BattleLaneResult['lane'], winner: BattleLaneResult['winner'], winRate: number | null) {
  return {
    lane: id,
    mine: [`Radiant ${id}`],
    opponent: [`Dire ${id}`],
    winner,
    winRate,
    mineIds: [1],
    opponentIds: [11],
    topPair: null,
  } satisfies BattleLaneResult;
}

describe('LaneMatchups', () => {
  it('shows the server even flag as Even, with no winning colour, even when the number leans', () => {
    render(<LaneMatchups lanes={[lane('safe', 'even', 0.51), lane('mid', 'mine', 0.6)]} />);
    const [safe, mid] = screen.getAllByTestId('battle-lane-card');

    expect(safe).toHaveAttribute('data-winner', 'even');
    expect(within(safe).getByText('Even')).toBeInTheDocument();
    expect(within(safe).getByText('51%').className).toBe('');

    expect(mid).toHaveAttribute('data-winner', 'mine');
    expect(within(mid).getByText('60%')).toHaveClass('battle-matchup-wr--good');
  });

  it('captions the lane number as the real lane win rate (STRATZ) when it comes from lane data', () => {
    render(
      <LaneMatchups
        lanes={[{ ...lane('safe', 'opponent', 0.4), rateSource: 'lane' }, lane('off', 'even', null)]}
      />,
    );
    const [withNumber, withoutNumber] = screen.getAllByTestId('battle-lane-card');

    expect(within(withNumber).getByText('60%')).toBeInTheDocument();
    const note = within(withNumber).getByTestId('battle-lane-note');
    expect(note).toHaveAttribute('data-source', 'lane');
    expect(note).toHaveTextContent('real lane win rate, draws excluded (STRATZ, Legend–Immortal pubs)');
    expect(within(withoutNumber).queryByTestId('battle-lane-note')).toBeNull();
  });

  it('says so when a lane fell back to the game-matchup proxy, or was stored before lane data', () => {
    render(
      <LaneMatchups
        lanes={[{ ...lane('safe', 'mine', 0.58), rateSource: 'matchup' }, lane('mid', 'mine', 0.6)]}
      />,
    );
    for (const card of screen.getAllByTestId('battle-lane-card')) {
      const note = within(card).getByTestId('battle-lane-note');
      expect(note).toHaveAttribute('data-source', 'matchup');
      expect(note).toHaveTextContent('no lane data: average real game matchup win rate (OpenDota)');
    }
  });
});

describe('ConfidenceNote', () => {
  it('says the tier is a gap on our scale, not a real-match prediction', () => {
    render(<ConfidenceNote />);
    expect(screen.getByTestId('battle-confidence-note')).toHaveTextContent(
      "This is how far apart the drafts landed on our scale. In this game a High favourite wins; real matches don't work like that.",
    );
  });
});

describe('story lane copy (T1.3)', () => {
  const lanesAndPairs = ['openingLaneHook', 'turningCatchCombo', 'turningCatch', 'turningCombo'] as const;

  it('describes lanes and pairs as a detail of the picture, not as the cause', () => {
    for (const key of lanesAndPairs) {
      expect(ru.battle.story[key]).not.toMatch(/Ломается|садится на|Перелом/);
      expect(en.battle.story[key]).not.toMatch(/breaks in|gets onto|That's the turn|turn hangs/i);
    }
  });

  it('quotes lane numbers as lanes won, not as game win rates', () => {
    const numbered = ['mineHunt', 'mineLean', 'oppHunt', 'oppHole'] as const;
    for (const key of numbered) {
      expect(ru.battle.explain.lane[key]).toMatch(/{{pairPct}}% линий/);
      expect(en.battle.explain.lane[key]).toMatch(/{{pairPct}}% of lanes/);
      expect(ru.battle.explain.lane[key]).not.toMatch(/садится на/);
    }
    for (const key of ['openingLaneHook', 'openingLaneSoft'] as const) {
      expect(ru.battle.story[key]).toMatch(/выигранных линий/);
      expect(en.battle.story[key]).toMatch(/lanes/);
    }
  });
});
