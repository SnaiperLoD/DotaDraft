import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HeroService } from '../hero/hero.service';
import { DraftService } from '../draft/draft.service';
import { EvaluationService } from '../evaluation/evaluation.service';
import {
  CM_RESERVE_MS,
  CM_STEPS,
  assignUniqueRoles,
  type CaptainsStateView,
  type CmSlot,
  type PooledDraftSummary,
  type PooledHeroRole,
} from 'shared';
import { chooseAiBan, chooseAiPick } from './captains-ai';
import { currentCmStep, emptyCmSlots } from './captains-sequence';
import type { Hero } from 'shared';
import { HeroMetaService } from '../hero-meta/hero-meta.service';
import { logPersistenceFailure } from '../common/log';

@Injectable()
export class CaptainsService {
  private readonly acting = new Map<string, Promise<CaptainsStateView>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly heroService: HeroService,
    private readonly draftService: DraftService,
    private readonly evaluationService: EvaluationService,
    private readonly heroMeta: HeroMetaService,
  ) {}

  async start(ownerToken: string, playerIsFirst = Math.random() < 0.5): Promise<CaptainsStateView> {
    const token = this.requireToken(ownerToken);
    const now = new Date();
    const slots = emptyCmSlots(playerIsFirst);
    let row = await this.prisma.captainsSession.create({
      data: {
        ownerToken: token,
        status: 'DRAFTING',
        stepIndex: 0,
        playerReserveMs: CM_RESERVE_MS,
        aiReserveMs: CM_RESERVE_MS,
        stepStartedAt: now,
        actionsJson: JSON.stringify(slots),
      },
    });
    const roster = await this.heroService.findAll();
    if (!playerIsFirst) {
      row = await this.resolveAiUntilPlayer(row, roster);
    }
    return this.toView(row, roster);
  }

  async get(id: string, ownerToken: string): Promise<CaptainsStateView> {
    const row = await this.loadOwned(id, ownerToken);
    return this.toView(row, await this.heroService.findAll());
  }

  async act(
    id: string,
    ownerToken: string,
    heroId: number | null,
    timedOut: boolean,
  ): Promise<CaptainsStateView> {
    const running = this.acting.get(id);
    if (running) return running;
    const pending = this.doAct(id, ownerToken, heroId, timedOut);
    this.acting.set(id, pending);
    try {
      return await pending;
    } finally {
      if (this.acting.get(id) === pending) this.acting.delete(id);
    }
  }

  private async doAct(
    id: string,
    ownerToken: string,
    heroId: number | null,
    timedOut: boolean,
  ): Promise<CaptainsStateView> {
    const token = this.requireToken(ownerToken);
    let row = await this.loadOwned(id, token);
    if (row.status !== 'DRAFTING') {
      return this.toView(row, await this.heroService.findAll());
    }

    const roster = await this.heroService.findAll();
    row = this.applyClock(row);
    const afterPlayer = await this.applyCurrentIfPlayer(row, roster, heroId, timedOut);
    if (!afterPlayer) {
      return this.toView(await this.loadOwned(id, token), roster);
    }
    row = afterPlayer;
    row = await this.resolveAiUntilPlayer(row, roster);
    if (row.stepIndex >= CM_STEPS.length && !row.draftId) {
      row = await this.finish(row, token, roster);
    }
    return this.toView(row, roster);
  }

  async assignRoles(
    id: string,
    ownerToken: string,
    assignments: { heroId: number; role: string }[],
  ): Promise<CaptainsStateView> {
    const token = this.requireToken(ownerToken);
    const row = await this.loadOwned(id, token);
    if (row.status !== 'ASSIGNING_ROLES' || !row.draftId) {
      throw new BadRequestException('Captains session is not assigning roles');
    }
    await this.draftService.assignRoles(row.draftId, assignments, token);
    if (row.aiDraftId) {
      await this.evaluationService.evaluate(row.aiDraftId, token).catch((err) => {
        logPersistenceFailure('captains.evaluateAi', err, { sessionId: row.id });
      });
    }
    await this.evaluationService.evaluate(row.draftId, token).catch((err) => {
      logPersistenceFailure('captains.evaluatePlayer', err, { sessionId: row.id });
    });
    const updated = await this.prisma.captainsSession.update({
      where: { id: row.id },
      data: { status: 'READY' },
    });
    return this.toView(updated, await this.heroService.findAll());
  }

  async getAiOpponent(sessionId: string, ownerToken: string): Promise<PooledDraftSummary> {
    const row = await this.loadOwned(sessionId, ownerToken);
    if (row.status !== 'READY') {
      throw new BadRequestException('Captains fight is not ready');
    }
    if (!row.aiDraftId) {
      throw new BadRequestException('Captains AI lineup is missing');
    }
    const draft = await this.draftService.getById(row.aiDraftId, ownerToken);
    const heroRoles: PooledHeroRole[] = draft.heroes.map((h) => ({
      heroId: h.heroId,
      role: h.assignedRole!,
    }));
    return {
      id: `captains-ai-${sessionId}`,
      source: 'player',
      heroIds: draft.heroes.map((h) => h.heroId),
      heroRoles,
      teamName: 'Dire',
      leagueName: 'Captains Mode',
      matchId: null,
    };
  }

  async markFought(sessionId: string, ownerToken: string): Promise<void> {
    const row = await this.loadOwned(sessionId, ownerToken);
    if (row.status === 'COMPLETED') {
      throw new BadRequestException('Captains fight already recorded');
    }
    if (row.status !== 'READY') {
      throw new BadRequestException('Captains session cannot record a fight yet');
    }
    await this.prisma.captainsSession.update({
      where: { id: row.id },
      data: { status: 'COMPLETED' },
    });
  }

  private applyClock(row: CaptainsRow): CaptainsRow {
    const step = currentCmStep(parseSlots(row.actionsJson), row.stepIndex);
    if (!step) return row;
    const elapsed = Date.now() - row.stepStartedAt.getTime();
    const overtime = Math.max(0, elapsed - step.timeMs);
    if (overtime === 0) return row;
    if (step.lane === 'first') {
      row.playerReserveMs = Math.max(0, row.playerReserveMs - overtime);
    } else {
      row.aiReserveMs = Math.max(0, row.aiReserveMs - overtime);
    }
    return row;
  }

  private async applyCurrentIfPlayer(
    row: CaptainsRow,
    roster: Hero[],
    heroId: number | null,
    timedOut: boolean,
  ): Promise<CaptainsRow | null> {
    const step = currentCmStep(parseSlots(row.actionsJson), row.stepIndex);
    if (!step) return row;
    if (step.lane !== 'first') {
      throw new BadRequestException('Not your turn');
    }
    const elapsed = Date.now() - row.stepStartedAt.getTime();
    if (elapsed > step.timeMs + row.playerReserveMs) timedOut = true;
    const slots = parseSlots(row.actionsJson);
    const taken = takenIds(slots);
    let chosen: number | null = null;
    if (!timedOut && heroId != null) {
      if (taken.has(heroId) || !roster.some((h) => h.id === heroId)) {
        throw new BadRequestException('Hero is not available');
      }
      chosen = heroId;
    } else if (step.type === 'pick') {
      const leftover = roster.filter((h) => !taken.has(h.id));
      chosen = leftover[Math.floor(Math.random() * leftover.length)]?.id ?? null;
    }
    slots[row.stepIndex] = { type: step.type, lane: step.lane, heroId: chosen };
    return this.commitStep(row, {
      actionsJson: JSON.stringify(slots),
      playerReserveMs: row.playerReserveMs,
      aiReserveMs: row.aiReserveMs,
    });
  }

  private async resolveAiUntilPlayer(row: CaptainsRow, roster: Hero[]): Promise<CaptainsRow> {
    let current = row;
    while (current.status === 'DRAFTING' && current.stepIndex < CM_STEPS.length) {
      const slots = parseSlots(current.actionsJson);
      const step = currentCmStep(slots, current.stepIndex);
      if (!step || step.lane === 'first') break;
      const taken = takenIds(slots);
      const aiHeroes = heroesFromSlots(roster, slots, 'second');
      const playerHeroes = heroesFromSlots(roster, slots, 'first');
      const ctx = { ownPicks: aiHeroes, opponentPicks: playerHeroes, lookup: this.heroMeta };
      const chosen = step.type === 'ban' ? chooseAiBan(roster, taken, ctx) : chooseAiPick(roster, taken, ctx);
      slots[current.stepIndex] = { type: step.type, lane: step.lane, heroId: chosen };
      const advanced = await this.commitStep(current, {
        actionsJson: JSON.stringify(slots),
        playerReserveMs: current.playerReserveMs,
        aiReserveMs: current.aiReserveMs,
      });
      if (!advanced) return this.loadOwned(current.id, current.ownerToken);
      current = advanced;
    }
    return current;
  }

  private async commitStep(
    row: CaptainsRow,
    data: { actionsJson: string; playerReserveMs: number; aiReserveMs: number },
  ): Promise<CaptainsRow | null> {
    const result = await this.prisma.captainsSession.updateMany({
      where: { id: row.id, stepIndex: row.stepIndex, status: 'DRAFTING' },
      data: {
        ...data,
        stepIndex: row.stepIndex + 1,
        stepStartedAt: new Date(),
      },
    });
    if (result.count === 0) return null;
    return this.loadOwned(row.id, row.ownerToken);
  }

  private async finish(row: CaptainsRow, token: string, roster: Hero[]): Promise<CaptainsRow> {
    const slots = parseSlots(row.actionsJson);
    const playerHeroIds = slots
      .filter((s) => s.lane === 'first' && s.type === 'pick' && s.heroId != null)
      .map((s) => s.heroId as number);
    const aiHeroIds = slots
      .filter((s) => s.lane === 'second' && s.type === 'pick' && s.heroId != null)
      .map((s) => s.heroId as number);
    if (playerHeroIds.length !== 5 || aiHeroIds.length !== 5) {
      throw new BadRequestException('Need 5 distinct heroes');
    }
    const aiHeroes = aiHeroIds.map((id) => roster.find((h) => h.id === id)!);
    const aiRoles = assignUniqueRoles(aiHeroes);
    const playerDraft = await this.draftService.createFromHeroIds(playerHeroIds, token, {
      mode: 'captains',
      status: 'ASSIGNING_ROLES',
    });
    const aiDraft = await this.draftService.createFromHeroIds(aiHeroIds, token, {
      mode: 'captains_ai',
      status: 'COMPLETED',
      roles: aiRoles,
    });
    return this.prisma.captainsSession.update({
      where: { id: row.id },
      data: { status: 'ASSIGNING_ROLES', draftId: playerDraft.id, aiDraftId: aiDraft.id },
    });
  }

  private toView(row: CaptainsRow, _roster: Hero[]): CaptainsStateView {
    const slots = parseSlots(row.actionsJson);
    const step = currentCmStep(slots, row.stepIndex);
    const stepEndsAt = new Date(row.stepStartedAt.getTime() + (step?.timeMs ?? 0)).toISOString();
    return {
      id: row.id,
      status: row.status as CaptainsStateView['status'],
      stepIndex: row.stepIndex,
      current: step,
      acting: step ? (step.lane === 'first' ? 'player' : 'ai') : null,
      slots,
      playerHeroIds: slots
        .filter((s) => s.lane === 'first' && s.type === 'pick' && s.heroId)
        .map((s) => s.heroId!),
      aiHeroIds: slots
        .filter((s) => s.lane === 'second' && s.type === 'pick' && s.heroId)
        .map((s) => s.heroId!),
      bannedHeroIds: slots.filter((s) => s.type === 'ban' && s.heroId).map((s) => s.heroId!),
      playerReserveMs: row.playerReserveMs,
      aiReserveMs: row.aiReserveMs,
      stepEndsAt,
      draftId: row.draftId,
      aiDraftId: row.aiDraftId,
    };
  }

  private requireToken(ownerToken: string): string {
    const token = ownerToken?.trim() ?? '';
    if (!token) throw new UnauthorizedException('Missing owner token');
    return token;
  }

  private async loadOwned(id: string, ownerToken: string): Promise<CaptainsRow> {
    const token = this.requireToken(ownerToken);
    const row = await this.prisma.captainsSession.findUnique({ where: { id } });
    if (!row || row.ownerToken !== token) throw new NotFoundException('Captains session not found');
    return row;
  }
}

type CaptainsRow = {
  id: string;
  ownerToken: string;
  status: string;
  stepIndex: number;
  playerReserveMs: number;
  aiReserveMs: number;
  stepStartedAt: Date;
  actionsJson: string;
  draftId: string | null;
  aiDraftId: string | null;
  createdAt: Date;
};

function parseSlots(json: string): CmSlot[] {
  return JSON.parse(json) as CmSlot[];
}

function takenIds(slots: CmSlot[]): Set<number> {
  return new Set(slots.map((s) => s.heroId).filter((id): id is number => id != null));
}

function heroesFromSlots(roster: Hero[], slots: CmSlot[], lane: CmSlot['lane']): Hero[] {
  const ids = slots
    .filter((s) => s.lane === lane && s.type === 'pick' && s.heroId != null)
    .map((s) => s.heroId as number);
  return ids.map((id) => roster.find((h) => h.id === id)).filter((h): h is Hero => Boolean(h));
}
