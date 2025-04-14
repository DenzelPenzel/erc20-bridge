import {
  IsString,
  IsEthereumAddress,
  IsNumberString,
  IsIn,
  Validate,
} from 'class-validator';
import { Network } from '../../types';

export class MintTokensDto {
  @IsString()
  @IsEthereumAddress()
  recipient: string;

  @IsNumberString()
  @Validate(
    (value: string) => {
      const num = parseFloat(value);
      if (isNaN(num)) return false;
      if (num < 0.01) return false;
      if (num > 1) return false;
      return true;
    },
    {
      message: 'Amount must be between 0.01 and 1',
    },
  )
  amount: string;

  @IsString()
  @IsIn([Network.ARBITRUM_SEPOLIA, Network.OPTIMISM_SEPOLIA])
  network: Network;
}
