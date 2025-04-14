import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { GelatoRelay } from '@gelatonetwork/relay-sdk';
import { Network, TransactionStatus } from '../types';
import MockERC20Abi from '../contracts/abi/MockERC20.json';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BridgeService {
  private readonly logger = new Logger(BridgeService.name);
  private readonly gelatoRelay: GelatoRelay;
  private readonly providers: Record<Network, ethers.providers.JsonRpcProvider>;
  private readonly contracts: Record<Network, ethers.Contract>;
  private readonly bridgeOperator: Record<Network, ethers.Wallet>;

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

    this.gelatoRelay = new GelatoRelay();

    const privateKey =
      this.configService.get<string>('BRIDGE_OPERATOR_PRIVATE_KEY') ||
      '0x0000000000000000000000000000000000000000000000000000000000000001';

    this.bridgeOperator = {
      [Network.ARBITRUM_SEPOLIA]: new ethers.Wallet(
        privateKey,
        this.providers[Network.ARBITRUM_SEPOLIA],
      ),
      [Network.OPTIMISM_SEPOLIA]: new ethers.Wallet(
        privateKey,
        this.providers[Network.OPTIMISM_SEPOLIA],
      ),
    };

    this.contracts = {
      [Network.ARBITRUM_SEPOLIA]: new ethers.Contract(
        this.configService.get<string>('ARBITRUM_ERC20_ADDRESS') || '',
        MockERC20Abi,
        this.bridgeOperator[Network.ARBITRUM_SEPOLIA],
      ),
      [Network.OPTIMISM_SEPOLIA]: new ethers.Contract(
        this.configService.get<string>('OPTIMISM_ERC20_ADDRESS') || '',
        MockERC20Abi,
        this.bridgeOperator[Network.OPTIMISM_SEPOLIA],
      ),
    };
  }

  async getUserTransactions(
    recipient: string,
    limit: number = 10,
    offset: number = 0,
    status?: string[],
  ) {
    const whereClause: any = { recipient };

    if (status && status.length > 0) {
      whereClause.status = { in: status };
    }

    const totalCount = await this.prisma.bridgeTransaction.count({
      where: whereClause,
    });

    const transactions = await this.prisma.bridgeTransaction.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return {
      transactions,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + transactions.length < totalCount,
      },
    };
  }

  async processBridgeRequest(
    recipient: string,
    amount: string,
    sourceNetwork: Network,
    targetNetwork: Network,
  ) {
    this.logger.log(
      `Processing bridge request from ${sourceNetwork} to ${targetNetwork} for ${recipient} with amount ${amount}`,
    );

    if (sourceNetwork === targetNetwork) {
      throw new BadRequestException(
        'Source and target networks must be different',
      );
    }

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

    const sourceContract = this.contracts[sourceNetwork];
    if (!sourceContract || !sourceContract.address) {
      throw new BadRequestException(
        `Contract not configured for ${sourceNetwork}`,
      );
    }

    const apiKey = this.configService.get<string>('GELATO_API_KEY');
    if (!apiKey) {
      throw new BadRequestException('Gelato API key is not configured');
    }

    try {
      const burnData = sourceContract.interface.encodeFunctionData('burn', [
        recipient,
        amountInWei,
      ]);

      const sourceChainId =
        sourceNetwork === Network.ARBITRUM_SEPOLIA
          ? BigInt(421614) // Arbitrum Sepolia
          : BigInt(11155420); // Optimism Sepolia

      const burnRequest = {
        chainId: sourceChainId,
        target: sourceContract.address,
        data: burnData,
      };
      const { taskId } = await this.gelatoRelay.sponsoredCall(
        burnRequest,
        apiKey,
        {
          gasLimit: BigInt(1000000),
        },
      );

      return {
        taskId,
        status: TransactionStatus.PROCESSING,
        message: 'Bridge transaction initiated successfully',
      };
    } catch (error) {
      this.logger.error(
        `Error bridge transaction: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Failed to initiate bridge transaction: ${error.message}`,
      );
    }
  }
}
