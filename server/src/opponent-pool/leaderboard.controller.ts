import { Controller, Get, Query } from '@nestjs/common';
import { OpponentPoolService } from './opponent-pool.service';
import { DraftService } from '../draft/draft.service';
import type { LeaderboardResponse } from 'shared';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
// Minimum Battle Mode fights for a draft to count as a "run" on the Best Runs
// board — high on purpose (rewards sustained sessions, filters one-offs); see
// DraftService.getBestRuns and the 2026-08-13 session log.
const RUN_MIN_FIGHTS = 5;

// Separate top-level route from OpponentPoolController's /opponent-pool
// base path (cleaner client-facing URL for a player-facing feature) but
// same module/service — the leaderboard IS Opponent Pool data (same
// shared Postgres, same submitterToken concept), not a new subsystem.
@Controller('leaderboard')
export class LeaderboardController {
  constructor(
    private readonly opponentPoolService: OpponentPoolService,
    private readonly draftService: DraftService,
  ) {}

  // Two-part leaderboard (user request): `runs` = the calling players' own best
  // single-session drafts (SQLite BattleResult, DraftService), `pool` = pooled
  // drafts ranked by their passive opponent record (Postgres, OpponentPool).
  // Fetched together so the page renders both sections from one request.
  @Get()
  async getLeaderboard(@Query('limit') limitParam?: string): Promise<LeaderboardResponse> {
    const parsed = limitParam ? parseInt(limitParam, 10) : NaN;
    const limit = Number.isNaN(parsed) ? DEFAULT_LIMIT : Math.min(MAX_LIMIT, Math.max(1, parsed));
    const [runs, pool] = await Promise.all([
      this.draftService.getBestRuns(limit, RUN_MIN_FIGHTS),
      this.opponentPoolService.getLeaderboard(limit),
    ]);
    return { runs, pool };
  }
}
