import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ProComposition {
  matchId: string;
  heroIds: number[];
  teamName: string | null;
  leagueName: string | null;
}

@Injectable()
export class ProMatchService {
  private winningCache: ProComposition[] | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getWinningCompositions(): Promise<ProComposition[]> {
    if (this.winningCache) return this.winningCache;
    const matches = await this.prisma.proMatch.findMany();
    this.winningCache = matches.map((m) => ({
      matchId: m.id,
      heroIds: JSON.parse(m.radiantWin ? m.radiantHeroIds : m.direHeroIds) as number[],
      teamName: m.radiantWin ? m.radiantName : m.direName,
      leagueName: m.leagueName,
    }));
    return this.winningCache;
  }
}
