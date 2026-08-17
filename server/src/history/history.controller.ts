import { Controller, Get } from '@nestjs/common';
import { HistoryService } from './history.service';
import { OwnerToken } from '../common/owner-token';

@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get()
  findAll(@OwnerToken() ownerToken: string) {
    return this.historyService.findAll(ownerToken);
  }
}
