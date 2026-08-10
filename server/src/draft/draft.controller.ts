import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DraftService } from './draft.service';
import type { PickRequest, AssignRolesRequest, CreateDraftRequest } from 'shared';

@Controller('draft')
export class DraftController {
  constructor(private readonly draftService: DraftService) {}

  // Replaces the old POST /draft/start, which created a row per page view.
  // POST rather than GET despite having no side effects: it returns a
  // different pool on every call, which is exactly what a browser or proxy
  // will happily serve from cache if it's a GET.
  @Post('pool')
  pool() {
    return this.draftService.generatePool();
  }

  // Creates the draft. Carries the first pick, because a draft with no
  // heroes is precisely what we don't want in the database.
  @Post()
  create(@Body() body: CreateDraftRequest) {
    return this.draftService.create(body.seed, body.heroId, body.rerollUsed);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.draftService.getById(id);
  }

  @Post(':id/pick')
  pick(@Param('id') id: string, @Body() body: PickRequest) {
    return this.draftService.pick(id, body.heroId);
  }

  @Post(':id/reroll')
  reroll(@Param('id') id: string) {
    return this.draftService.reroll(id);
  }

  @Post(':id/roles')
  assignRoles(@Param('id') id: string, @Body() body: AssignRolesRequest) {
    return this.draftService.assignRoles(id, body.assignments);
  }
}
