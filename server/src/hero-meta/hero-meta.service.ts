import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

// Confidence-weighted shrinkage instead of a hard sample-size cutoff
// (Blueprint/10-tech-debt-backlog.md, "Battle Engine Confidence Tier не
// откалиброван" — the old MIN_GAMES=10 hard cutoff treated an 11-game
// sample exactly as confidently as a 500-game one). Shrinks the raw win
// rate toward the neutral 0.5 prior, weighted by `games / (games +
// SHRINKAGE_K)`: a pair with `games` well below SHRINKAGE_K contributes
// little to synergyBonus/matchupEdge in battle-resolution.ts (which just
// average `winRate - 0.5` unweighted — shrinkage does the confidence
// weighting instead of a separate weighted-average step), while `games`
// well above it is barely shrunk at all. K=20 is a starting point, not
// calibrated against real outcomes yet.
const SHRINKAGE_K = 20;

function shrinkTowardNeutral(winRate: number, games: number): number {
  const weight = games / (games + SHRINKAGE_K);
  return weight * winRate + (1 - weight) * 0.5;
}

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
    if (!entry || entry.games === 0) return null;
    return shrinkTowardNeutral(entry.wins / entry.games, entry.games);
  }

  getSynergyWinRate(heroId: number, allyHeroId: number): number | null {
    const entry = this.byHeroId.get(heroId)?.synergy.find((s) => s.allyHeroId === allyHeroId);
    if (!entry || entry.games === 0) return null;
    return shrinkTowardNeutral(entry.wins / entry.games, entry.games);
  }

  getWinRate(heroId: number): number | null {
    return this.byHeroId.get(heroId)?.winRate ?? null;
  }
}
