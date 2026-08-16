import { expect, type Page, type Route } from '@playwright/test';
import type { BattleResultResponse, Hero } from 'shared';

export const ROLES = ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'] as const;

const storyParams = {
  matchupWinner: 'Tidehunter',
  matchupLoser: 'Phantom Assassin',
  matchupWinRate: '64',
  winnerSide: 'yours',
  swingHero: '',
  topAxis: 'control',
  winnerLanes: '2',
  loserLanes: '0',
  driver: 'Storm Spirit',
  theirDriver: 'Axe',
  turner: '',
  comboA: '',
  comboB: '',
  comboWinRate: '',
  posture: 'ahead',
  myCarry: 'Anti-Mage',
  theirCarry: 'Axe',
  lateMatchupWinner: 'Anti-Mage',
  carryWinRate: '58',
  scaleLeader: 'Anti-Mage',
  roshanBand: '20–30',
  openingLane: 'safe',
  openingPairHero: 'Anti-Mage',
  openingPairVs: 'Axe',
  openingPairWinRate: '62',
};

export const battleFixture: BattleResultResponse = {
  resolvedOutcome: 'Win',
  advantageDirection: 'A',
  confidenceTier: 'Moderate',
  advantages: ['Your draft has stronger control.'],
  disadvantages: [],
  explanation: [
    'Your draft was favored and converted the matchup.',
    'Your safe lane leans this way because Anti-Mage into Axe is a real matchup edge.',
  ],
  bestPairs: [],
  bestMatchups: [],
  worstMatchups: [],
  winningHighlights: ['Axe matched into Anti-Mage.'],
  shutdownHeroIds: [],
  shutdownNotes: [],
  lanes: [
    {
      lane: 'safe',
      mine: ['Anti-Mage', 'Crystal Maiden'],
      opponent: ['Axe', 'Earthshaker'],
      winner: 'mine',
      winRate: 0.58,
      mineIds: [1, 5],
      opponentIds: [2, 7],
      topPair: { hero: 'Anti-Mage', heroId: 1, vs: 'Axe', vsId: 2, winRate: 0.62 },
    },
    {
      lane: 'mid',
      mine: ['Storm Spirit'],
      opponent: ['Shadow Fiend'],
      winner: 'mine',
      winRate: 0.62,
      mineIds: [17],
      opponentIds: [11],
      topPair: { hero: 'Storm Spirit', heroId: 17, vs: 'Shadow Fiend', vsId: 11, winRate: 0.62 },
    },
    {
      lane: 'off',
      mine: ['Tidehunter', 'Earth Spirit'],
      opponent: ['Phantom Assassin', 'Lion'],
      winner: 'even',
      winRate: 0.5,
      mineIds: [29, 107],
      opponentIds: [44, 26],
      topPair: null,
    },
  ],
  story: {
    cameFromBehind: false,
    isUpset: false,
    beats: [
      {
        phase: 'opening',
        key: 'openingAhead',
        params: storyParams,
        evidence: {
          heroIds: [1, 17, 7],
          lanes: [
            { lane: 'safe', winner: 'mine' },
            { lane: 'mid', winner: 'mine' },
            { lane: 'off', winner: 'even' },
          ],
        },
      },
      {
        phase: 'turn',
        key: 'turningCatch',
        params: storyParams,
        evidence: { heroIds: [1, 17, 7], matchup: { winnerId: 7, loserId: 44 } },
      },
      {
        phase: 'conversion',
        key: 'conversionRoshanMid',
        params: storyParams,
        evidence: { heroIds: [1, 17, 7] },
      },
      {
        phase: 'finish',
        key: 'finishHeld',
        params: storyParams,
        evidence: { heroIds: [1, 17, 7] },
      },
    ],
  },
  opponent: {
    source: 'pro',
    teamName: 'E2E Opponent',
    leagueName: 'Test League',
    matchId: null,
    heroes: [
      { heroId: 2, heroName: 'Axe', assignedRole: 'Carry' },
      { heroId: 11, heroName: 'Shadow Fiend', assignedRole: 'Mid' },
      { heroId: 44, heroName: 'Phantom Assassin', assignedRole: 'Offlane' },
      { heroId: 7, heroName: 'Earthshaker', assignedRole: 'Soft Support' },
      { heroId: 26, heroName: 'Lion', assignedRole: 'Hard Support' },
    ],
  },
};

export async function seedClientPrefs(page: Page, theme: 'light' | 'dark' = 'dark') {
  await page.addInitScript((choice) => {
    localStorage.setItem('dotadraft-theme', choice);
    localStorage.setItem('dotadraft-lang', 'en');
    document.documentElement.dataset.theme = choice;
  }, theme);
}

export async function mockBattle(page: Page, result: BattleResultResponse = battleFixture) {
  await page.route('**/api/battle', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({ json: result });
  });
}

export async function pickFiveHeroes(page: Page) {
  for (let round = 0; round < 5; round += 1) {
    await expect(page.getByTestId('hero-card')).toHaveCount(5);
    await page.getByTestId('hero-card').first().click();
  }
  await expect(page.getByTestId('confirm-roles')).toBeVisible();
}

export async function assignRolesInOrder(page: Page) {
  const cards = page.locator('.role-assignment-card');
  await expect(cards).toHaveCount(5);
  for (let i = 0; i < ROLES.length; i += 1) {
    await cards.nth(i).getByTestId('role-cell').nth(i).click();
  }
  await page.getByTestId('confirm-roles').click();
  await expect(page.getByTestId('evaluate-draft')).toBeVisible();
}

export async function evaluateDraft(page: Page) {
  await page.getByTestId('evaluate-draft').click();
  await expect(page.getByTestId('evaluation-result')).toBeVisible();
}

export async function completeDraftToEvaluation(page: Page) {
  await page.goto('/draft');
  await pickFiveHeroes(page);
  await assignRolesInOrder(page);
  await evaluateDraft(page);
}

export async function enterBattle(page: Page) {
  await page.getByTestId('enter-battle-mode').click();
  await expect(page.getByTestId('battle-verdict')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('battle-story')).toBeVisible();
  await expect(page.getByTestId('battle-story-beat')).toHaveCount(4);
  await expect(page.getByTestId('battle-lanes')).toBeVisible();
  await expect(page.getByTestId('battle-lane-card')).toHaveCount(3);
  await expect(page.getByTestId('battle-story-beat').first()).toContainText('2–0');
  await expect(page.getByTestId('battle-story-beat').first()).toContainText('Storm Spirit');
  await expect(page.getByTestId('battle-story-beat').first()).not.toContainText('advantage goes to');
}

export async function fetchHeroes(page: Page): Promise<Hero[]> {
  const response = await page.request.get('/api/heroes');
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Hero[];
}
