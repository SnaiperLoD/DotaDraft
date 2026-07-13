import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

// Minimum sample size before a matchup/synergy win rate is trusted — small
// samples (a handful of games) swing wildly and would make Battle Engine
// output noisy rather than meaningfully better than a coin flip.
const MIN_GAMES = 10;

interface HeroMetaEntry {
  heroId: number;
  winRate: number | null;
  synergy: { allyHeroId: number; games: number; wins: number }[];
  matchups: { opponentHeroId: number; games: number; wins: number }[];
}

// Loads server/data/hero-meta.json (the Milestone 3 OpenDota snapshot) once
// and exposes hero-vs-hero / ally win-rate lookups for Battle Engine, per
// Blueprint/06-battle-engine.md: "hero-matchup factor should read from data
// collected during Milestone 3's import... not be queried live."
@Injectable()
export class HeroMetaService {
  private readonly byHeroId = new Map<number, HeroMetaEntry>();

  constructor() {
    const metaPath = path.join(__dirname, '..', '..', 'data', 'hero-meta.json');
    if (!fs.existsSync(metaPath)) return;

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { heroes: HeroMetaEntry[] };
    for (const entry of meta.heroes) {
      this.byHeroId.set(entry.heroId, entry);
    }
  }

  getMatchupWinRate(heroId: number, opponentHeroId: number): number | null {
    const entry = this.byHeroId.get(heroId)?.matchups.find((m) => m.opponentHeroId === opponentHeroId);
    if (!entry || entry.games < MIN_GAMES) return null;
    return entry.wins / entry.games;
  }

  getSynergyWinRate(heroId: number, allyHeroId: number): number | null {
    const entry = this.byHeroId.get(heroId)?.synergy.find((s) => s.allyHeroId === allyHeroId);
    if (!entry || entry.games < MIN_GAMES) return null;
    return entry.wins / entry.games;
  }

  getWinRate(heroId: number): number | null {
    return this.byHeroId.get(heroId)?.winRate ?? null;
  }
}
