import type { PooledDraftSource } from './opponent-pool';
import type { LocalizedLine } from './i18n';
import type { DraftArchetype } from './evaluation';

export type ConfidenceTier = 'Low' | 'Moderate' | 'High';
export type AdvantageDirection = 'A' | 'B' | 'Even';
export type ResolvedOutcome = 'Win' | 'Lose';

export interface BattleOpponentHero {
  heroId: number;
  heroName: string;
  assignedRole?: string | null;
  // See PooledHeroRole.playerName (opponent-pool.ts) — only ever set for
  // 'pro' opponents with backfilled player data.
  playerName?: string | null;
}

export type BattleLaneId = 'safe' | 'mid' | 'off';
export type BattleLaneWinner = 'mine' | 'opponent' | 'even';

export interface BattleLaneTopPair {
  hero: string;
  heroId: number;
  vs: string;
  vsId: number;
  winRate: number;
}

// Where a lane's numbers come from: 'lane' = real lane win rate per hero pair
// (STRATZ laneOutcome, server/data/lane-outcomes.json); 'matchup' = fallback
// proxy, the average pro GAME matchup win rate (OpenDota hero-meta).
export type BattleLaneRateSource = 'lane' | 'matchup';

export interface BattleLaneResult {
  lane: BattleLaneId;
  mine: string[];
  opponent: string[];
  // 'even' when the average pair rate sits within LANE_EVEN_SPREAD_PP of 50%
  // (server/src/battle/battle-lanes.ts) — the single even-lane flag every
  // surface reads (lane card, Explanation, story).
  winner: BattleLaneWinner;
  // Mine's average pair rate in this lane (0.5 + averageEdge): the real
  // lane win rate when rateSource is 'lane', the game-matchup proxy when
  // 'matchup'. null when the lane had no pair data at all.
  winRate: number | null;
  mineIds: number[];
  opponentIds: number[];
  // Best pair for the winning side in this lane (same source as winRate).
  // null when the lane is even or no pair data exists for the winner.
  topPair: BattleLaneTopPair | null;
  // Additive (2026-10-02). Absent on payloads built before then, which all
  // used the 'matchup' proxy — readers treat absent as 'matchup'. null when
  // winRate is null.
  rateSource?: BattleLaneRateSource | null;
}

export interface BattleOpponent {
  source: PooledDraftSource;
  heroes: BattleOpponentHero[];
  teamName: string | null;
  leagueName: string | null;
  // OpenDota matchId, present only for 'pro' opponents. See
  // Blueprint/10-tech-debt-backlog.md, "Ссылка на исходный матч для про-пиков".
  matchId: string | null;
  // Same Evaluate classifier as the player's draft. Display-only; optional
  // on older History snapshots that never stored it.
  archetype?: DraftArchetype;
}

export interface BattleRequest {
  draftId: string;
  submitterToken: string;
  // Playtest async clash: pasted Copy Draft text (role: hero per line).
  copiedDraft?: string;
  captainsSessionId?: string;
  tiRunId?: string;
}

// Real pair rows surfaced in the battle result, always from the calling
// player's own draft perspective (teamA), win or lose. `winRate` is a cleaned
// STRATZ pub pair share since 2026-10-03 (0.5 + edge over what both heroes'
// strength predicts), shown by the client as a signed pp edge. Unlike the
// narrative `winningHighlights`, these carry the number so the client can
// show it — a deliberate exception to the file's usual "no raw
// percentage" convention, by direct user request ("show real best pairs by
// win rate, best/worst matchups vs the opponent's draft").
export interface BattlePair {
  heroA: string;
  heroAId: number;
  heroB: string;
  heroBId: number;
  winRate: number;
}

export interface BattleMatchup {
  hero: string;
  heroId: number;
  vs: string;
  vsId: number;
  // Cleaned STRATZ pair share of `hero` into `vs` (2026-10-03): 0.5 + how far
  // the pair beats what both heroes' own strength predicts, confidence-shrunk
  // toward 0.5 by sample size (HeroMetaService). NOT a game win rate; the
  // client shows the edge over 0.5 in percentage points.
  winRate: number;
  // `hero`'s overall real win rate. Informational only since 2026-10-03: the
  // pair share above already has hero strength removed, so it is neither the
  // ranking baseline nor shown next to the pair edge. null when the snapshot
  // has no overall win rate for the hero.
  baseWinRate: number | null;
}

export type BattleStoryPhase = 'opening' | 'turn' | 'conversion' | 'finish';

export type BattleStoryBeatKey =
  | 'openingAhead'
  | 'openingComeback'
  | 'openingEven'
  | 'openingUpset'
  | 'turningCatchCombo'
  | 'turningCatch'
  | 'turningEdgeCombo'
  | 'turningEdge'
  | 'turningCombo'
  | 'turningAxis'
  // Largest axis gap did not belong to the winner — name it without crediting a side.
  | 'turningAxisSplit'
  | 'turningUpsetHighSkill'
  | 'conversionRoshanEarly'
  | 'conversionRoshanMid'
  | 'conversionRoshanLate'
  | 'finishHeld'
  | 'finishComeback'
  | 'finishUpset';

export interface BattleStoryLaneEvidence {
  lane: BattleLaneId;
  winner: BattleLaneWinner;
}

export interface BattleStoryMatchupEvidence {
  winnerId: number;
  loserId: number;
}

export interface BattleStoryBeatEvidence {
  heroIds: number[];
  lanes?: BattleStoryLaneEvidence[];
  matchup?: BattleStoryMatchupEvidence;
}

export interface BattleStoryBeat {
  phase: BattleStoryPhase;
  key: BattleStoryBeatKey;
  // Interpolation bag for client i18n. Values are hero names or side keys
  // (`yours` / `opponent`), never pre-translated prose.
  params: Record<string, string>;
  evidence: BattleStoryBeatEvidence;
}

export interface BattleStory {
  cameFromBehind: boolean;
  isUpset: boolean;
  beats: BattleStoryBeat[];
}

export interface BattleResultResponse {
  resolvedOutcome: ResolvedOutcome;
  advantageDirection: AdvantageDirection;
  confidenceTier: ConfidenceTier;
  // Axis keys (`tempo`, `control`, …) for client i18n. Legacy History rows
  // may still store full English sentences — the client accepts both.
  advantages: string[];
  disadvantages: string[];
  // I18nLine[] for new fights; plain English strings for History snapshots.
  explanation: LocalizedLine[];
  // Your draft's best real synergy pairs (getSynergyWinRate), and your best /
  // worst individual matchups into THIS opponent's heroes (getMatchupWinRate).
  // Empty when no real matchup data is available for the heroes in play.
  bestPairs: BattlePair[];
  bestMatchups: BattleMatchup[];
  worstMatchups: BattleMatchup[];
  // Blueprint/10-tech-debt-backlog.md, "Комментарии по конкретным успешным
  // матчапам" — top real matchup/synergy pairs for whichever side actually
  // won this battle. I18nLine[] (or legacy English strings).
  winningHighlights: LocalizedLine[];
  // Shutdown (common/shutdown.ts) — hero ids on EITHER side whose real
  // matchup win rate is below their own average vs every hero on the other
  // draft. Client marks portraits and builds localized notes from
  // shutdownHeroIds; shutdownNotes are the same copy as I18nLine (or
  // legacy English strings in History).
  shutdownHeroIds: number[];
  shutdownNotes: LocalizedLine[];
  lanes?: BattleLaneResult[];
  // Domain narrative assembled server-side (battle-story.ts). React only
  // renders `beats` through i18n — it does not pick farmers or phases.
  story: BattleStory;
  opponent: BattleOpponent;
  // Player's draft shape from Evaluate's classifier. Display-only; optional
  // on older clients / History snapshots.
  archetype?: DraftArchetype;
  // Public custom tags that were active for either side this fight, plus
  // what they did. Hidden calibration tags stay out. Optional on History.
  tagChips?: BattleTagChip[];
  // Challenge vs the same five heroes (including pasting your own code).
  // Client skips axes/story and plays a coin toss after the 5v5 face-off.
  coinFlip?: boolean;
}

export interface BattleTagChip {
  name: string;
  rarity: string;
  side: 'mine' | 'opponent';
  // Axis keys The Fundamentals boosted this fight. Client localizes.
  fundamentalsAxes?: string[];
}
