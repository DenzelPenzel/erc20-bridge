import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { GelatoRelay } from '@gelatonetwork/relay-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { Network, TransactionStatus } from '../types';
import MockERC20Abi from '../contracts/abi/MockERC20.json';

@Injectable()
export class MintService {
  private readonly logger = new Logger(MintService.name);
  private readonly providers: Record<Network, ethers.providers.JsonRpcProvider>;
  private readonly contracts: Record<Network, ethers.Contract>;
  private readonly gelatoRelay: GelatoRelay;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.providers = {
      [Network.ARBITRUM_SEPOLIA]: new ethers.providers.JsonRpcProvider(
        this.configService.get<string>('ARBITRUM_SEPOLIA_RPC_URL') ||
          'https://sepolia-rollup.arbitrum.io/rpc',
      ),
      [Network.OPTIMISM_SEPOLIA]: new ethers.providers.JsonRpcProvider(
        this.configService.get<string>('OPTIMISM_SEPOLIA_RPC_URL') ||
          'https://sepolia.optimism.io',
      ),
    };

    this.contracts = {
      [Network.ARBITRUM_SEPOLIA]: new ethers.Contract(
        this.configService.get<string>('ARBITRUM_ERC20_ADDRESS') || '',
        MockERC20Abi,
        this.providers[Network.ARBITRUM_SEPOLIA],
      ),
      [Network.OPTIMISM_SEPOLIA]: new ethers.Contract(
        this.configService.get<string>('OPTIMISM_ERC20_ADDRESS') || '',
        MockERC20Abi,
        this.providers[Network.OPTIMISM_SEPOLIA],
      ),
    };

    this.gelatoRelay = new GelatoRelay();
  }

  async mintTokens(recipient: string, amount: string, network: Network) {
    this.logger.log(`Minting ${amount} tokens to ${recipient} on ${network}`);

    if (!ethers.utils.isAddress(recipient)) {
      throw new BadRequestException('Invalid recipient address');
    }

    let amountInWei: ethers.BigNumber;
    try {
      amountInWei = ethers.utils.parseEther(amount);
      if (amountInWei.lte(0)) {
        throw new BadRequestException('Amount must be greater than 0');
      }
    } catch (error) {
      throw new BadRequestException(`Invalid amount: ${error.message}`);
    }

    const apiKey = this.configService.get<string>('GELATO_API_KEY');
    if (!apiKey) {
      throw new BadRequestException('Gelato API key is not configured');
    }

    const contract = this.contracts[network];
    if (!contract || !contract.address) {
      throw new BadRequestException(
        `Contract not found for network ${network}`,
      );
    }

    try {
      const data = contract.interface.encodeFunctionData('mint', [
        recipient,
        amountInWei,
      ]);

      const chainId =
        network === Network.ARBITRUM_SEPOLIA
          ? BigInt(421614) // Arbitrum Sepolia
          : BigInt(11155420); // Optimism Sepolia

      const request = {
        chainId,
        target: contract.address,
        data,
      };
      const { taskId } = await this.gelatoRelay.sponsoredCall(request, apiKey, {
        gasLimit: BigInt(1000000),
      });

      return {
        taskId,
        status: TransactionStatus.PENDING,
        message: 'Mint transaction submitted successfully',
      };
    } catch (error) {
      this.logger.error(`Error minting tokens: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to mint tokens: ${error.message}`);
    }
  }
}
