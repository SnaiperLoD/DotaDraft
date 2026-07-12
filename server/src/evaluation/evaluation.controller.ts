import { Controller, Get, Param } from '@nestjs/common';
import { EvaluationService } from './evaluation.service';

@Controller('evaluation')
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  @Get(':draftId')
  evaluate(@Param('draftId') draftId: string) {
    return this.evaluationService.evaluate(draftId);
  }
}
