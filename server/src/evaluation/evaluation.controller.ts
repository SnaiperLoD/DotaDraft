import { Controller, Get, Param } from '@nestjs/common';
import { EvaluationService } from './evaluation.service';
import { OwnerToken } from '../common/owner-token';
import { assertDraftId } from '../common/request-validation';

@Controller('evaluation')
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  @Get(':draftId')
  evaluate(@OwnerToken() ownerToken: string, @Param('draftId') draftId: string) {
    return this.evaluationService.evaluate(assertDraftId(draftId), ownerToken);
  }
}
