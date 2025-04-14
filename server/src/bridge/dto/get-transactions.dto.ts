import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  IsEthereumAddress,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GetTransactionsDto {
  @IsString()
  @IsEthereumAddress()
  recipient: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  status?: string[];
}
