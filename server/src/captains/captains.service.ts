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
import type { Hero } from 'shared';
import { logPersistenceFailure } from '../common/log';

@Injectable()
export class CaptainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly heroService: HeroService,
    private readonly draftService: DraftService,
    private readonly evaluationService: EvaluationService,
  ) {}

  async start(ownerToken: string): Promise<CaptainsStateView> {
    const token = this.requireToken(ownerToken);
    const now = new Date();
    const row = await this.prisma.captainsSession.create({
      data: {
        ownerToken: token,
        status: 'DRAFTING',
        stepIndex: 0,
        playerReserveMs: CM_RESERVE_MS,
        aiReserveMs: CM_RESERVE_MS,
        stepStartedAt: now,
        actionsJson: JSON.stringify(
          CM_STEPS.map((step) => ({ type: step.type, lane: step.lane, heroId: null })),
        ),
      },
    });
    return this.toView(row, await this.heroService.findAll());
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
    const token = this.requireToken(ownerToken);
    let row = await this.loadOwned(id, token);
    if (row.status !== 'DRAFTING') {
      return this.toView(row, await this.heroService.findAll());
    }

    const roster = await this.heroService.findAll();
    row = this.applyClock(row);
    row = await this.applyCurrentIfPlayer(row, roster, heroId, timedOut);
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
    if (row.status !== 'READY' && row.status !== 'COMPLETED') {
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
    if (row.status === 'COMPLETED') return;
    if (row.status !== 'READY') {
      throw new BadRequestException('Captains session cannot record a fight yet');
    }
    await this.prisma.captainsSession.update({
      where: { id: row.id },
      data: { status: 'COMPLETED' },
    });
  }

  private applyClock(row: CaptainsRow): CaptainsRow {
    if (row.stepIndex >= CM_STEPS.length) return row;
    const step = CM_STEPS[row.stepIndex];
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
  ): Promise<CaptainsRow> {
    if (row.stepIndex >= CM_STEPS.length) return row;
    const step = CM_STEPS[row.stepIndex];
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
    return this.prisma.captainsSession.update({
      where: { id: row.id },
      data: {
        stepIndex: row.stepIndex + 1,
        stepStartedAt: new Date(),
        actionsJson: JSON.stringify(slots),
        playerReserveMs: row.playerReserveMs,
        aiReserveMs: row.aiReserveMs,
      },
    });
  }

  private async resolveAiUntilPlayer(row: CaptainsRow, roster: Hero[]): Promise<CaptainsRow> {
    let current = row;
    while (current.status === 'DRAFTING' && current.stepIndex < CM_STEPS.length) {
      const step = CM_STEPS[current.stepIndex];
      if (step.lane === 'first') break;
      const slots = parseSlots(current.actionsJson);
      const taken = takenIds(slots);
      const aiPicked = slots.filter((s) => s.lane === 'second' && s.type === 'pick' && s.heroId != null);
      const aiHeroes = roster.filter((h) => aiPicked.some((s) => s.heroId === h.id));
      const chosen = step.type === 'ban' ? chooseAiBan(roster, taken) : chooseAiPick(roster, taken, aiHeroes);
      slots[current.stepIndex] = { type: step.type, lane: step.lane, heroId: chosen };
      current = await this.prisma.captainsSession.update({
        where: { id: current.id },
        data: {
          stepIndex: current.stepIndex + 1,
          stepStartedAt: new Date(),
          actionsJson: JSON.stringify(slots),
          playerReserveMs: current.playerReserveMs,
          aiReserveMs: current.aiReserveMs,
        },
      });
    }
    return current;
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
    const step = row.stepIndex < CM_STEPS.length ? CM_STEPS[row.stepIndex] : null;
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
