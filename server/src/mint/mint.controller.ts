import { Controller, Post, Body } from '@nestjs/common';
import { MintService } from './mint.service';
import { MintTokensDto } from './dto/mint-tokens.dto';

@Controller('mint')
export class MintController {
  constructor(private readonly mintService: MintService) {}

  @Post()
  async mintTokens(@Body() mintTokensDto: MintTokensDto) {
    return this.mintService.mintTokens(
      mintTokensDto.recipient,
      mintTokensDto.amount,
      mintTokensDto.network,
    );
  }
}
