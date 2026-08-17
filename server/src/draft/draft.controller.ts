import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DraftService } from './draft.service';
import { OwnerToken } from '../common/owner-token';
import {
  assertAssignRolesBody,
  assertCreateDraftBody,
  assertDraftId,
  assertPickBody,
} from '../common/request-validation';

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
  create(@OwnerToken() ownerToken: string, @Body() body: unknown) {
    const parsed = assertCreateDraftBody(body);
    return this.draftService.create(parsed.seed, parsed.heroId, parsed.rerollUsed, ownerToken);
  }

  @Get(':id')
  getById(@OwnerToken() ownerToken: string, @Param('id') id: string) {
    return this.draftService.getById(assertDraftId(id), ownerToken);
  }

  @Post(':id/pick')
  pick(@OwnerToken() ownerToken: string, @Param('id') id: string, @Body() body: unknown) {
    return this.draftService.pick(assertDraftId(id), assertPickBody(body).heroId, ownerToken);
  }

  @Post(':id/reroll')
  reroll(@OwnerToken() ownerToken: string, @Param('id') id: string) {
    return this.draftService.reroll(assertDraftId(id), ownerToken);
  }

  @Post(':id/roles')
  assignRoles(@OwnerToken() ownerToken: string, @Param('id') id: string, @Body() body: unknown) {
    return this.draftService.assignRoles(
      assertDraftId(id),
      assertAssignRolesBody(body).assignments,
      ownerToken,
    );
  }
}
