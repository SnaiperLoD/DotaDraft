import { Body, Controller, Post } from '@nestjs/common';
import { BattleService } from './battle.service';
import type { BattleRequest } from 'shared';

@Controller('battle')
export class BattleController {
  constructor(private readonly battleService: BattleService) {}

  @Post()
  fight(@Body() body: BattleRequest) {
    return this.battleService.fight(body.draftId, body.submitterToken);
  }
}
