import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BattleLaneResult } from 'shared';
import { ConfidenceNote, LaneMatchups, MatchupList } from './BattlePanel';
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
      expect(note).toHaveTextContent(
        'no lane data: average game matchup edge from real pubs (STRATZ); 50% = as both heroes’ strength predicts',
      );
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

describe('pair rows (cleaned STRATZ pair shares, 2026-10-03)', () => {
  it('shows the edge over what the heroes strength predicts, not a game win rate or the hero baseline', () => {
    render(
      <MatchupList
        heading="Best"
        good
        rows={[
          { hero: 'Axe', heroId: 2, vs: 'Lina', vsId: 25, winRate: 0.54, baseWinRate: 0.52 },
          { hero: 'Zeus', heroId: 22, vs: 'Lion', vsId: 26, winRate: 0.479, baseWinRate: 0.5 },
        ]}
      />,
    );
    expect(screen.getByText('+4.0 pp')).toHaveClass('battle-matchup-wr--good');
    expect(screen.getByText('−2.1 pp')).toBeInTheDocument();
    expect(screen.queryByText(/52%|54%|→/)).toBeNull();
  });

  it('captions the pair rows as interaction edges in both locales', () => {
    expect(en.battle.realWinRateNote).toMatch(/STRATZ/);
    expect(en.battle.realWinRateNote).not.toMatch(/OpenDota|overall →/);
    expect(ru.battle.realWinRateNote).toMatch(/STRATZ/);
    expect(ru.battle.realWinRateNote).not.toMatch(/OpenDota|→/);
    expect(en.battle.pairEdge).toBe('{{edge}} pp');
    expect(ru.battle.pairEdge).toBe('{{edge}} п.п.');
  });

  it('quotes game pair numbers in story copy as edges, never as "% in real games"', () => {
    const matchupKeys = ['turningCatchCombo', 'turningCatch', 'turningEdgeCombo', 'turningEdge'] as const;
    const comboKeys = ['turningCatchCombo', 'turningEdgeCombo', 'turningCombo'] as const;
    for (const locale of [en, ru]) {
      for (const key of matchupKeys) expect(locale.battle.story[key]).toMatch(/\+{{matchupEdge}}/);
      for (const key of comboKeys) expect(locale.battle.story[key]).toMatch(/\+{{comboEdge}}/);
      for (const key of ['carryLateMatchup', 'carryLateSoft'] as const) {
        expect(locale.battle.story[key]).toMatch(/\+{{carryEdge}}/);
      }
      expect(JSON.stringify(locale.battle.story)).not.toMatch(/matchupWinRate|comboWinRate|carryWinRate/);
    }
  });
});
