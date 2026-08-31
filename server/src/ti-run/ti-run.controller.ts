import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TiRunService } from './ti-run.service';
import { OwnerToken } from '../common/owner-token';
import { assertDraftActionBody, assertDraftId, assertTiRunChooseBody } from '../common/request-validation';

@Controller('ti-run')
export class TiRunController {
  constructor(private readonly tiRunService: TiRunService) {}

  @Post()
  start(@OwnerToken() ownerToken: string) {
    return this.tiRunService.start(ownerToken);
  }

  @Get(':id')
  get(@OwnerToken() ownerToken: string, @Param('id') id: string) {
    return this.tiRunService.get(assertDraftId(id), ownerToken);
  }

  @Post(':id/choose')
  choose(@OwnerToken() ownerToken: string, @Param('id') id: string, @Body() body: unknown) {
    return this.tiRunService.choose(assertDraftId(id), ownerToken, assertTiRunChooseBody(body).teamName);
  }

  @Post(':id/attach')
  attach(@OwnerToken() ownerToken: string, @Param('id') id: string, @Body() body: unknown) {
    return this.tiRunService.attachDraft(assertDraftId(id), ownerToken, assertDraftActionBody(body).draftId);
  }
}
