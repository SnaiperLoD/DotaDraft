import { Body, Controller, Post } from '@nestjs/common';
import { BattleService } from './battle.service';
import { OwnerToken } from '../common/owner-token';
import { assertDraftActionBody } from '../common/request-validation';

@Controller('battle')
export class BattleController {
  constructor(private readonly battleService: BattleService) {}

  @Post()
  fight(@OwnerToken() ownerToken: string, @Body() body: unknown) {
    return this.battleService.fight(assertDraftActionBody(body).draftId, ownerToken);
  }
}
