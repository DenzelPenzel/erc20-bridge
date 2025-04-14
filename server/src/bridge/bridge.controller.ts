import { Controller, Get, Post, Query, Body } from '@nestjs/common';
import { BridgeService } from './bridge.service';

import { GetTransactionsDto } from './dto/get-transactions.dto';
import { BridgeTokensDto } from './dto/bridge-tokens.dto';

@Controller('bridge')
export class BridgeController {
  constructor(private readonly bridgeService: BridgeService) {}

  @Get('transactions')
  async getUserTransactions(@Query() query: GetTransactionsDto) {
    return this.bridgeService.getUserTransactions(
      query.recipient,
      query.limit,
      query.offset,
      query.status,
    );
  }

  @Post('bridge')
  async bridgeTokens(@Body() bridgeTokensDto: BridgeTokensDto) {
    return this.bridgeService.processBridgeRequest(
      bridgeTokensDto.recipient,
      bridgeTokensDto.amount,
      bridgeTokensDto.sourceNetwork,
      bridgeTokensDto.targetNetwork,
    );
  }
}
