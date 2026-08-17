import { Body, Controller, Post } from '@nestjs/common';
import { OpponentPoolService } from './opponent-pool.service';
import { OwnerToken } from '../common/owner-token';
import { assertDraftActionBody } from '../common/request-validation';

@Controller('opponent-pool')
export class OpponentPoolController {
  constructor(private readonly poolService: OpponentPoolService) {}

  @Post('commit')
  commit(@OwnerToken() ownerToken: string, @Body() body: unknown) {
    return this.poolService.commit(assertDraftActionBody(body).draftId, ownerToken);
  }
}
