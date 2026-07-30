import { Controller, Get, Query } from '@nestjs/common';
import { OpponentPoolService } from './opponent-pool.service';
import type { LeaderboardEntryView } from 'shared';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Separate top-level route from OpponentPoolController's /opponent-pool
// base path (cleaner client-facing URL for a player-facing feature) but
// same module/service — the leaderboard IS Opponent Pool data (same
// shared Postgres, same submitterToken concept), not a new subsystem.
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly opponentPoolService: OpponentPoolService) {}

  @Get()
  async getLeaderboard(@Query('limit') limitParam?: string): Promise<LeaderboardEntryView[]> {
    const parsed = limitParam ? parseInt(limitParam, 10) : NaN;
    const limit = Number.isNaN(parsed) ? DEFAULT_LIMIT : Math.min(MAX_LIMIT, Math.max(1, parsed));
    return this.opponentPoolService.getLeaderboard(limit);
  }
}
