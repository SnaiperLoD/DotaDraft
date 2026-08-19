import { Controller, Get, Query } from '@nestjs/common';
import { OpponentPoolService } from './opponent-pool.service';
import { DraftService } from '../draft/draft.service';
import { OptionalOwnerToken } from '../common/owner-token';
import type { LeaderboardResponse } from 'shared';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
// Minimum Battle Mode fights for a draft to count as a "run" on the all-runs
// / my-runs boards — playtest 2026-08-19: 10 fights, ranked by win rate.
const RUN_MIN_FIGHTS = 10;

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

  // Three-part leaderboard (playtest 2026-08-19): `globalRuns` = every
  // qualifying Battle run, `runs` = the caller's own runs, `pool` = pooled
  // drafts ranked by their passive opponent record. Fetched together so the
  // page renders all sections from one request. Assumption: keep the pool
  // board — it measures a different loop (draft as opponent), not a duplicate
  // of all-runs.
  @Get()
  async getLeaderboard(
    @OptionalOwnerToken() ownerToken: string | null,
    @Query('limit') limitParam?: string,
  ): Promise<LeaderboardResponse> {
    const parsed = limitParam ? parseInt(limitParam, 10) : NaN;
    const limit = Number.isNaN(parsed) ? DEFAULT_LIMIT : Math.min(MAX_LIMIT, Math.max(1, parsed));
    const [globalRuns, runs, pool] = await Promise.all([
      this.draftService.getBestRuns(limit, RUN_MIN_FIGHTS, ownerToken, 'global'),
      this.draftService.getBestRuns(limit, RUN_MIN_FIGHTS, ownerToken, 'mine'),
      this.opponentPoolService.getLeaderboard(limit, ownerToken),
    ]);
    return { globalRuns, runs, pool };
  }
}
