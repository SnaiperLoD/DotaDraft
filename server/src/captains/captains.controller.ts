import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CaptainsService } from './captains.service';
import { OwnerToken } from '../common/owner-token';
import { assertCaptainsActBody, assertDraftId } from '../common/request-validation';

@Controller('captains')
export class CaptainsController {
  constructor(private readonly captainsService: CaptainsService) {}

  @Post()
  start(@OwnerToken() ownerToken: string) {
    return this.captainsService.start(ownerToken);
  }

  @Get(':id')
  get(@OwnerToken() ownerToken: string, @Param('id') id: string) {
    return this.captainsService.get(assertDraftId(id), ownerToken);
  }

  @Post(':id/act')
  act(@OwnerToken() ownerToken: string, @Param('id') id: string, @Body() body: unknown) {
    const parsed = assertCaptainsActBody(body);
    return this.captainsService.act(assertDraftId(id), ownerToken, parsed.heroId, parsed.timedOut);
  }
}
