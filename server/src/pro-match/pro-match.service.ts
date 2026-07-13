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
  constructor(private readonly prisma: PrismaService) {}

  async getWinningCompositions(): Promise<ProComposition[]> {
    const matches = await this.prisma.proMatch.findMany();
    return matches.map((m) => ({
      matchId: m.id,
      heroIds: JSON.parse(m.radiantWin ? m.radiantHeroIds : m.direHeroIds) as number[],
      teamName: m.radiantWin ? m.radiantName : m.direName,
      leagueName: m.leagueName,
    }));
  }
}
