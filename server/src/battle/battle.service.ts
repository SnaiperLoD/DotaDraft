import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DraftService } from '../draft/draft.service';
import { HeroService } from '../hero/hero.service';
import { HeroMetaService } from '../hero-meta/hero-meta.service';
import { OpponentPoolService } from '../opponent-pool/opponent-pool.service';
import { CaptainsService } from '../captains/captains.service';
import { TiRunService } from '../ti-run/ti-run.service';
import { resolveBattle, type BattlePick } from './battle-resolution';
import { alignOpponentToRoles } from './opponent-alignment';
import { buildBattleStory } from './battle-story';
import { buildLaneResults } from './battle-lanes';
import { ROLES, resolveCopiedDraft, displayProPlayerName, opponentTeamCaption } from 'shared';
import type { BattleResultResponse, Hero, PooledDraftSummary, PooledHeroRole, ResolvedOutcome } from 'shared';
import { logPersistenceFailure } from '../common/log';
import { classifyPicksArchetype } from '../evaluation/draft-archetype';
import { flipCoin, shouldCoinFlipChallenge } from './challenge-mirror';

@Injectable()
export class BattleService {
  private readonly inflight = new Map<string, Promise<BattleResultResponse>>();

  constructor(
    private readonly draftService: DraftService,
    private readonly heroService: HeroService,
    private readonly heroMetaService: HeroMetaService,
    private readonly opponentPoolService: OpponentPoolService,
    private readonly captainsService: CaptainsService,
    private readonly tiRunService: TiRunService,
  ) {}

  async fight(
    draftId: string,
    submitterToken: string,
    opts: { copiedDraft?: string | null; captainsSessionId?: string | null; tiRunId?: string | null } = {},
  ): Promise<BattleResultResponse> {
    const running = this.inflight.get(draftId);
    if (running) {
      // Serialize fights on the same draft. Fight Again is a new fight, not
      // a replay of the in-flight one — wait, then run.
      await running.catch(() => undefined);
    }
    const pending = this.doFight(draftId, submitterToken, opts);
    this.inflight.set(draftId, pending);
    try {
      return await pending;
    } finally {
      if (this.inflight.get(draftId) === pending) this.inflight.delete(draftId);
    }
  }

  private async doFight(
    draftId: string,
    submitterToken: string,
    opts: { copiedDraft?: string | null; captainsSessionId?: string | null; tiRunId?: string | null } = {},
  ): Promise<BattleResultResponse> {
    const exclusive = [opts.copiedDraft, opts.captainsSessionId, opts.tiRunId].filter(Boolean);
    if (exclusive.length > 1) {
      throw new BadRequestException('Choose one opponent source');
    }
    const draft = await this.draftService.getById(draftId, submitterToken);
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.status !== 'COMPLETED') {
      throw new BadRequestException('Draft must be completed before entering Battle Mode');
    }

    const teamA: BattlePick[] = draft.heroes.map((h) => ({ hero: h.hero, assignedRole: h.assignedRole }));

    const facedOpponents = await this.draftService.getFacedOpponentHeroSets(draftId);
    let opponent: PooledDraftSummary;
    let stage: string | null = null;
    if (opts.captainsSessionId) {
      opponent = await this.captainsService.getAiOpponent(opts.captainsSessionId, submitterToken);
    } else if (opts.tiRunId) {
      const prepared = await this.tiRunService.prepareFight(opts.tiRunId, submitterToken);
      opponent = prepared.opponent;
      stage = prepared.stage;
    } else if (opts.copiedDraft) {
      opponent = await this.opponentFromCopiedDraft(opts.copiedDraft);
    } else {
      opponent = await this.opponentPoolService.pullRandom(
        submitterToken,
        draft.heroes.map((h) => h.heroId),
        facedOpponents,
      );
    }
    const opponentHeroes = await this.heroService.findByIds(opponent.heroIds);
    // heroRoles is null for pool rows committed before role-fit reached
    // Battle Engine (see opponent-pool schema) — those heroes just get no
    // boost, same as any hero with assignedRole: null.
    const roleByHeroId = new Map((opponent.heroRoles ?? []).map((r) => [r.heroId, r.role]));
    // playerName is only ever populated for 'pro' rows with backfilled
    // OpenDota player data (see PooledHeroRole.playerName) — undefined for
    // everything else, same null-safe map lookup as roleByHeroId.
    const playerNameByHeroId = new Map((opponent.heroRoles ?? []).map((r) => [r.heroId, r.playerName]));
    const teamB: BattlePick[] = opponentHeroes.map((hero) => ({
      hero,
      assignedRole: roleByHeroId.get(hero.id) ?? null,
    }));

    const teamBAligned =
      heroesInRoleOrder(opponentHeroes, opponent.heroRoles) ?? alignOpponentToRoles(opponentHeroes);

    if (
      shouldCoinFlipChallenge(
        opts.copiedDraft,
        draft.heroes.map((h) => h.heroId),
        opponent.heroIds,
      )
    ) {
      return this.finishCoinFlip({
        draftId,
        teamA,
        teamB,
        teamBAligned,
        opponent,
        playerNameByHeroId,
      });
    }

    const mineByRole = new Map(
      teamA
        .filter((pick): pick is BattlePick & { assignedRole: string } => pick.assignedRole != null)
        .map((pick) => [pick.assignedRole, pick.hero]),
    );
    const opponentByRole = new Map(teamBAligned.map((hero, index) => [ROLES[index], hero]));
    const lanes = buildLaneResults(mineByRole, opponentByRole, this.heroMetaService);
    const opponentPicks: BattlePick[] = teamBAligned.map((hero, index) => ({
      hero,
      assignedRole: ROLES[index],
    }));

    // Fight math still uses pool-stored teamB roles. Lanes and the aligned
    // opponent roster are display-side only — passed so Explanation talks
    // about the same lane cards the client renders.
    const result = resolveBattle(teamA, teamB, this.heroMetaService, Math.random, {
      lanes,
      narrativeOpponent: opponentPicks,
    });

    const story = buildBattleStory({
      resolvedOutcome: result.resolvedOutcome,
      advantageDirection: result.advantageDirection,
      confidenceTier: result.confidenceTier,
      lanes,
      mine: teamA,
      opponent: opponentPicks,
      lookup: this.heroMetaService,
      highSkillSwingHeroName: result.highSkillSwingHeroName,
      topAxis: result.topAxis,
    });

    // Persisted for History (Blueprint/10-tech-debt-backlog.md, "Сохранять
    // в истории результаты боёв") — best-effort, same reasoning as
    // EvaluationService: a storage hiccup shouldn't fail the fight itself.
    await this.draftService
      .saveBattleResult(draftId, {
        resolvedOutcome: result.resolvedOutcome,
        advantageDirection: result.advantageDirection,
        confidenceTier: result.confidenceTier,
        opponentSource: opponent.source,
        opponentTeamName: opponent.teamName,
        opponentLeagueName: opponent.leagueName,
        opponentHeroIds: opponent.heroIds,
        stage,
      })
      .catch((err) => {
        logPersistenceFailure('battle.saveResult', err, { draftId });
      });

    // Best-effort, same reasoning as saveBattleResult above — the
    // leaderboard (Blueprint/10-tech-debt-backlog.md, "Лидерборд драфтов")
    // is a nice-to-have ranking, not something that should ever fail
    // Battle Mode itself if the shared Postgres pool is briefly
    // unreachable. Inverted outcome: result.resolvedOutcome is from the
    // CALLING player's perspective (teamA) — the opponent draft (teamB)
    // won exactly when the caller lost, and vice versa.
    const opponentOutcome: ResolvedOutcome = result.resolvedOutcome === 'Win' ? 'Lose' : 'Win';
    if (!opponent.id.startsWith('challenge-') && !opponent.id.startsWith('captains-ai-')) {
      await this.opponentPoolService.recordDraftOutcome(opponent.id, opponentOutcome).catch((err) => {
        logPersistenceFailure('battle.recordDraftOutcome', err, { draftId, opponentId: opponent.id });
      });
    }
    if (opts.captainsSessionId) {
      await this.captainsService.markFought(opts.captainsSessionId, submitterToken);
    }
    if (opts.tiRunId) {
      await this.tiRunService.recordFight(opts.tiRunId, submitterToken, {
        outcome: result.resolvedOutcome,
        advantageDirection: result.advantageDirection,
        confidenceTier: result.confidenceTier,
      });
    }

    // Display-only Evaluate headline (Tempo / Late / 4+1 / …). Computed after
    // resolveBattle so it cannot change who wins. Pool-stored roles for the
    // opponent — same role-aware axis path Evaluate uses on a submitted draft.
    const archetype = classifyPicksArchetype(teamA);
    const opponentArchetype = classifyPicksArchetype(teamB);

    const caption = opponentTeamCaption(opponent.teamName, opponent.leagueName);

    return {
      resolvedOutcome: result.resolvedOutcome,
      advantageDirection: result.advantageDirection,
      confidenceTier: result.confidenceTier,
      advantages: result.advantages,
      disadvantages: result.disadvantages,
      explanation: result.explanation,
      winningHighlights: result.winningHighlights,
      bestPairs: result.bestPairs,
      bestMatchups: result.bestMatchups,
      worstMatchups: result.worstMatchups,
      shutdownHeroIds: result.shutdownHeroIds,
      shutdownNotes: result.shutdownNotes,
      lanes,
      story,
      archetype,
      tagChips: result.tagChips,
      opponent: {
        source: opponent.source,
        heroes: teamBAligned.map((h, index) => ({
          heroId: h.id,
          heroName: h.name,
          assignedRole: ROLES[index],
          playerName: displayProPlayerName(playerNameByHeroId.get(h.id) ?? null),
        })),
        teamName: caption.teamName,
        leagueName: caption.leagueName,
        matchId: opponent.matchId,
        archetype: opponentArchetype,
      },
    };
  }

  private async finishCoinFlip(args: {
    draftId: string;
    teamA: BattlePick[];
    teamB: BattlePick[];
    teamBAligned: Hero[];
    opponent: PooledDraftSummary;
    playerNameByHeroId: Map<number, string | null | undefined>;
  }): Promise<BattleResultResponse> {
    const resolvedOutcome = flipCoin(Math.random);
    const caption = opponentTeamCaption(args.opponent.teamName, args.opponent.leagueName);
    const archetype = classifyPicksArchetype(args.teamA);
    const opponentArchetype = classifyPicksArchetype(args.teamB);

    await this.draftService
      .saveBattleResult(args.draftId, {
        resolvedOutcome,
        advantageDirection: 'Even',
        confidenceTier: 'Low',
        opponentSource: args.opponent.source,
        opponentTeamName: args.opponent.teamName,
        opponentLeagueName: args.opponent.leagueName,
        opponentHeroIds: args.opponent.heroIds,
        stage: null,
      })
      .catch((err) => {
        logPersistenceFailure('battle.saveResult', err, { draftId: args.draftId });
      });

    return {
      resolvedOutcome,
      advantageDirection: 'Even',
      confidenceTier: 'Low',
      advantages: [],
      disadvantages: [],
      explanation: [],
      winningHighlights: [],
      bestPairs: [],
      bestMatchups: [],
      worstMatchups: [],
      shutdownHeroIds: [],
      shutdownNotes: [],
      lanes: [],
      story: { cameFromBehind: false, isUpset: false, beats: [] },
      coinFlip: true,
      archetype,
      opponent: {
        source: args.opponent.source,
        heroes: args.teamBAligned.map((h, index) => ({
          heroId: h.id,
          heroName: h.name,
          assignedRole: ROLES[index],
          playerName: displayProPlayerName(args.playerNameByHeroId.get(h.id) ?? null),
        })),
        teamName: caption.teamName,
        leagueName: caption.leagueName,
        matchId: args.opponent.matchId,
        archetype: opponentArchetype,
      },
    };
  }

  // Playtest async clash: paste of a Copy Draft code (or legacy Role: Hero
  // lines). Synthetic opponent — still saved on the caller's run, but never
  // written back to the pool (no pool id).
  private async opponentFromCopiedDraft(text: string): Promise<PooledDraftSummary> {
    let resolved: { heroIds: number[]; heroRoles: PooledHeroRole[] };
    try {
      resolved = resolveCopiedDraft(text, await this.heroService.findAll());
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    return {
      id: `challenge-${[...resolved.heroIds].sort((a, b) => a - b).join('-')}`,
      source: 'player',
      heroIds: resolved.heroIds,
      heroRoles: resolved.heroRoles,
      teamName: 'Challenge',
      leagueName: 'Copied draft',
      matchId: null,
    };
  }
}

function heroesInRoleOrder(heroes: Hero[], roles: PooledHeroRole[] | null): Hero[] | null {
  if (!roles) return null;
  const byId = new Map(heroes.map((h) => [h.id, h]));
  const ordered: Hero[] = [];
  for (const role of ROLES) {
    const row = roles.find((r) => r.role === role);
    if (!row) return null;
    const hero = byId.get(row.heroId);
    if (!hero) return null;
    ordered.push(hero);
  }
  return ordered.length === 5 ? ordered : null;
}
