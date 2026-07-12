import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DraftService } from './draft.service';
import type { PickRequest, AssignRolesRequest } from 'shared';

@Controller('draft')
export class DraftController {
  constructor(private readonly draftService: DraftService) {}

  @Post('start')
  start() {
    return this.draftService.start();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.draftService.getById(id);
  }

  @Post(':id/pick')
  pick(@Param('id') id: string, @Body() body: PickRequest) {
    return this.draftService.pick(id, body.heroId);
  }

  @Post(':id/roles')
  assignRoles(@Param('id') id: string, @Body() body: AssignRolesRequest) {
    return this.draftService.assignRoles(id, body.assignments);
  }
}
