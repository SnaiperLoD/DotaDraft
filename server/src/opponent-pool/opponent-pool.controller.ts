import { Body, Controller, Post } from '@nestjs/common';
import { OpponentPoolService } from './opponent-pool.service';
import type { CommitDraftRequest } from 'shared';

@Controller('opponent-pool')
export class OpponentPoolController {
  constructor(private readonly poolService: OpponentPoolService) {}

  @Post('commit')
  commit(@Body() body: CommitDraftRequest) {
    return this.poolService.commit(body.draftId, body.submitterToken);
  }
}
