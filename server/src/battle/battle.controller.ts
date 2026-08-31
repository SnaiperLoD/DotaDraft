import { Body, Controller, Post } from '@nestjs/common';
import { BattleService } from './battle.service';
import { OwnerToken } from '../common/owner-token';
import { assertBattleBody } from '../common/request-validation';

@Controller('battle')
export class BattleController {
  constructor(private readonly battleService: BattleService) {}

  @Post()
  fight(@OwnerToken() ownerToken: string, @Body() body: unknown) {
    const parsed = assertBattleBody(body);
    return this.battleService.fight(parsed.draftId, ownerToken, {
      copiedDraft: parsed.copiedDraft,
      captainsSessionId: parsed.captainsSessionId,
      tiRunId: parsed.tiRunId,
    });
  }
}
