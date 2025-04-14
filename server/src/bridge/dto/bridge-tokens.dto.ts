import {
  IsString,
  IsEthereumAddress,
  IsNumberString,
  IsIn,
} from 'class-validator';
import { Network } from '../../types';

export class BridgeTokensDto {
  @IsString()
  @IsEthereumAddress()
  recipient: string;

  @IsNumberString()
  amount: string;

  @IsString()
  @IsIn([Network.ARBITRUM_SEPOLIA, Network.OPTIMISM_SEPOLIA])
  sourceNetwork: Network;

  @IsString()
  @IsIn([Network.ARBITRUM_SEPOLIA, Network.OPTIMISM_SEPOLIA])
  targetNetwork: Network;
}
