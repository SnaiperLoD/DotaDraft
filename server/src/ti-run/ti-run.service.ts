import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DraftService } from '../draft/draft.service';
import { OpponentPoolService } from '../opponent-pool/opponent-pool.service';
import { persistWithRetry } from '../common/persist-retry';
import {
  TI_BRACKETS,
  advanceBracket,
  historicalMover,
  openingMatch,
  playoffTeams,
  liveOpponent,
  projectLiveBracket,
  teamsMatch,
  tiBracketById,
  type PooledDraftSummary,
  type TiBracket,
  type TiPathFight,
  type TiRunStateView,
  type TiTeamCard,
} from 'shared';

type TiChoice = { teams: TiTeamCard[]; occupyAs?: string };

@Injectable()
export class TiRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly draftService: DraftService,
    private readonly opponentPoolService: OpponentPoolService,
  ) {}

  async start(ownerToken: string): Promise<TiRunStateView> {
    const token = this.requireToken(ownerToken);
    const eligible: { bracket: TiBracket; teams: TiTeamCard[] }[] = [];
    for (const bracket of TI_BRACKETS) {
      const names = playoffTeams(bracket.matches);
      const teams = await this.opponentPoolService.summarizeTeams(bracket.leagueName, names, bracket.aliases);
      if (teams.length > 0) eligible.push({ bracket, teams });
    }
    if (eligible.length === 0) {
      throw new ServiceUnavailableException('No TI playoff drafts in the opponent pool');
    }
    const picked = eligible[Math.floor(Math.random() * eligible.length)];
    const shuffled = [...picked.teams].sort(() => Math.random() - 0.5);
    const teams = shuffled.slice(0, Math.min(5, shuffled.length));
    const row = await this.prisma.tiRun.create({
      data: {
        ownerToken: token,
        bracketId: picked.bracket.id,
        leagueName: picked.bracket.leagueName,
        status: 'PICKING_TEAM',
        choiceJson: JSON.stringify({ teams } satisfies TiChoice),
        pathJson: '[]',
      },
    });
    return this.toView(row);
  }

  async get(id: string, ownerToken: string): Promise<TiRunStateView> {
    const row = await this.promoteIfDraftReady(await this.loadOwned(id, ownerToken), ownerToken);
    return this.toView(row);
  }

  async choose(id: string, ownerToken: string, teamName: string): Promise<TiRunStateView> {
    const token = this.requireToken(ownerToken);
    const row = await this.loadOwned(id, token);
    if (row.status !== 'PICKING_TEAM') {
      throw new BadRequestException('Team is already chosen');
    }
    const bracket = this.bracketOf(row.bracketId);
    const choice = parseChoice(row.choiceJson);
    const card = choice.teams.find((t) => teamsMatch(t.name, teamName, bracket.aliases));
    if (!card) {
      throw new BadRequestException('Team is not in this TI Run');
    }
    const opening = openingMatch(bracket.matches, card.name, bracket.aliases);
    const updated = await this.prisma.tiRun.update({
      where: { id: row.id },
      data: {
        teamName: card.name,
        currentMatchId: opening.id,
        status: 'SHOWING_BRACKET',
        choiceJson: JSON.stringify({ ...choice, occupyAs: card.name } satisfies TiChoice),
      },
    });
    return this.toView(updated);
  }

  async attachDraft(id: string, ownerToken: string, draftId: string): Promise<TiRunStateView> {
    const token = this.requireToken(ownerToken);
    const row = await this.loadOwned(id, token);
    if (row.status !== 'SHOWING_BRACKET' && row.status !== 'DRAFTING') {
      throw new BadRequestException('TI Run is not drafting');
    }
    if (row.draftId && row.draftId !== draftId) {
      throw new BadRequestException('This TI Run already has a draft');
    }
    const draft = await this.draftService.getById(draftId, token);
    if (draft.mode !== 'ti') {
      throw new BadRequestException('Draft is not a TI Run draft');
    }
    const status = draft.status === 'COMPLETED' ? 'PLAYING' : 'DRAFTING';
    const updated = await this.prisma.tiRun.update({
      where: { id: row.id },
      data: { draftId, status },
    });
    return this.toView(updated);
  }

  async prepareFight(
    id: string,
    ownerToken: string,
  ): Promise<{ opponent: PooledDraftSummary; stage: string }> {
    const row = await this.promoteIfDraftReady(await this.loadOwned(id, ownerToken), ownerToken);
    if (row.status !== 'PLAYING' || !row.currentMatchId || !row.teamName || !row.draftId) {
      throw new BadRequestException('TI Run is not ready to fight');
    }
    const bracket = this.bracketOf(row.bracketId);
    const match = bracket.matches.find((m) => m.id === row.currentMatchId);
    if (!match) throw new NotFoundException('Unknown match');
    const occupyAs = parseChoice(row.choiceJson).occupyAs ?? row.teamName;
    const opponentName = liveOpponent(match, occupyAs, row.teamName, bracket.aliases);
    const draft = await this.draftService.getById(row.draftId, ownerToken);
    const faced = await this.draftService.getFacedOpponentHeroSets(row.draftId);
    const opponent = await this.opponentPoolService.pullForTeam(
      opponentName,
      bracket.leagueName,
      bracket.aliases,
      match.matchIds,
      draft.heroes.map((h) => h.heroId),
      faced,
    );
    return { opponent, stage: match.round };
  }

  async recordFight(
    id: string,
    ownerToken: string,
    result: { outcome: 'Win' | 'Lose'; advantageDirection: string; confidenceTier: string },
  ): Promise<TiRunStateView> {
    const row = await this.loadOwned(id, ownerToken);
    if (row.status !== 'PLAYING' || !row.currentMatchId || !row.teamName) {
      throw new BadRequestException('TI Run is not playing');
    }
    const path = parsePath(row.pathJson);
    if (path.some((fight) => fight.matchId === row.currentMatchId)) {
      return this.toView(row);
    }
    const bracket = this.bracketOf(row.bracketId);
    const match = bracket.matches.find((m) => m.id === row.currentMatchId);
    if (!match) throw new NotFoundException('Unknown match');
    const choice = parseChoice(row.choiceJson);
    const occupyAs = choice.occupyAs ?? row.teamName;
    const opponentName = liveOpponent(match, occupyAs, row.teamName, bracket.aliases);
    const won = result.outcome === 'Win';
    const advanced = advanceBracket(bracket.matches, row.currentMatchId, won);
    path.push({
      matchId: row.currentMatchId,
      round: match.round,
      opponent: opponentName,
      outcome: result.outcome,
      advantageDirection: result.advantageDirection,
      confidenceTier: result.confidenceTier,
    });
    const nextOccupy = advanced.champion || advanced.eliminated ? occupyAs : historicalMover(match, won);
    const status = advanced.champion ? 'CHAMPION' : advanced.eliminated ? 'ELIMINATED' : 'PLAYING';
    const updated = await persistWithRetry(
      () =>
        this.prisma.tiRun.update({
          where: { id: row.id },
          data: {
            currentMatchId: advanced.nextMatchId,
            losses: row.losses + (won ? 0 : 1),
            status,
            pathJson: JSON.stringify(path),
            choiceJson: JSON.stringify({ ...choice, occupyAs: nextOccupy } satisfies TiChoice),
          },
        }),
      { label: 'tiRun.recordFight' },
    );
    return this.toView(updated);
  }

  private async promoteIfDraftReady(row: TiRunRow, ownerToken: string): Promise<TiRunRow> {
    if (!row.draftId || (row.status !== 'DRAFTING' && row.status !== 'SHOWING_BRACKET')) return row;
    const draft = await this.draftService.getById(row.draftId, ownerToken);
    if (draft.status !== 'COMPLETED') return row;
    return this.prisma.tiRun.update({
      where: { id: row.id },
      data: { status: 'PLAYING' },
    });
  }

  private toView(row: TiRunRow): TiRunStateView {
    const bracket = this.bracketOf(row.bracketId);
    const choice = parseChoice(row.choiceJson);
    const occupyAs = choice.occupyAs ?? row.teamName;
    const path = parsePath(row.pathJson);
    const match = row.currentMatchId
      ? (bracket.matches.find((m) => m.id === row.currentMatchId) ?? null)
      : null;
    let opponentName: string | null = null;
    if (match && occupyAs && row.teamName) {
      try {
        opponentName = liveOpponent(match, occupyAs, row.teamName, bracket.aliases);
      } catch {
        opponentName = null;
      }
    }
    return {
      id: row.id,
      status: row.status as TiRunStateView['status'],
      bracketId: row.bracketId,
      leagueName: row.leagueName,
      year: bracket.year,
      teams: choice.teams,
      teamName: row.teamName,
      draftId: row.draftId,
      currentMatchId: row.currentMatchId,
      currentRound: match?.round ?? null,
      opponentName,
      losses: row.losses,
      path,
      matches: projectLiveBracket(bracket.matches, {
        playerTeam: row.teamName,
        path,
        currentMatchId: row.currentMatchId,
        aliases: bracket.aliases,
      }),
    };
  }

  private bracketOf(id: string): TiBracket {
    const bracket = tiBracketById(id);
    if (!bracket) throw new NotFoundException('Unknown TI bracket');
    return bracket;
  }

  private requireToken(ownerToken: string): string {
    const token = ownerToken?.trim() ?? '';
    if (!token) throw new UnauthorizedException('Missing owner token');
    return token;
  }

  private async loadOwned(id: string, ownerToken: string): Promise<TiRunRow> {
    const token = this.requireToken(ownerToken);
    const row = await this.prisma.tiRun.findUnique({ where: { id } });
    if (!row || row.ownerToken !== token) throw new NotFoundException('TI Run not found');
    return row;
  }
}

type TiRunRow = {
  id: string;
  ownerToken: string;
  bracketId: string;
  leagueName: string;
  teamName: string | null;
  draftId: string | null;
  status: string;
  losses: number;
  currentMatchId: string | null;
  choiceJson: string;
  pathJson: string;
  createdAt: Date;
};

function parseChoice(json: string): TiChoice {
  try {
    const parsed = JSON.parse(json) as TiChoice;
    return { teams: parsed.teams ?? [], occupyAs: parsed.occupyAs };
  } catch {
    return { teams: [] };
  }
}

function parsePath(json: string): TiPathFight[] {
  try {
    return JSON.parse(json) as TiPathFight[];
  } catch {
    return [];
  }
}
