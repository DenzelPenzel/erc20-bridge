import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import {
  GelatoRelay,
  CallWithERC2771Request,
} from '@gelatonetwork/relay-sdk-viem';
import { Network, TransactionStatus } from '../types';
import MockERC20Abi from '../contracts/abi/MockERC20.json';
import { PrismaService } from '../prisma/prisma.service';
import { createWalletClient, http, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia, optimismSepolia } from 'viem/chains';

@Injectable()
export class BridgeService {
  private readonly logger = new Logger(BridgeService.name);
  private readonly gelatoRelay: GelatoRelay;
  private readonly providers: Record<Network, ethers.providers.JsonRpcProvider>;
  private readonly contracts: Record<Network, ethers.Contract>;
  private readonly chains: Record<Network, Chain>;

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

    this.chains = {
      [Network.ARBITRUM_SEPOLIA]: arbitrumSepolia,
      [Network.OPTIMISM_SEPOLIA]: optimismSepolia,
    };

    this.gelatoRelay = new GelatoRelay({
      contract: {
        relay1BalanceERC2771: '0xd8253782c45a12053594b9deB72d8e8aB2Fca54c',
        relayERC2771: '',
        relayERC2771zkSync: '',
        relayERC2771Abstract: '',
        relay1BalanceERC2771zkSync: '',
        relay1BalanceERC2771Abstract: '',
        relayConcurrentERC2771: '',
        relay1BalanceConcurrentERC2771: '',
        relayConcurrentERC2771zkSync: '',
        relayConcurrentERC2771Abstract: '',
        relay1BalanceConcurrentERC2771zkSync: '',
        relay1BalanceConcurrentERC2771Abstract: '',
      },
    });

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
  }

  async getUserTransactions(
    recipient?: string,
    limit: number = 10,
    offset: number = 0,
    status?: string[],
  ) {
    const whereClause: any = {};

    if (recipient) {
      whereClause.recipient = recipient;
    }

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

      const privateKey = this.configService.get<string>('PRIVATE_KEY');
      const account = privateKeyToAccount(privateKey as `0x${string}`);

      const walletClient = createWalletClient({
        account,
        chain: this.chains[sourceNetwork],
        transport: http(
          sourceNetwork === Network.ARBITRUM_SEPOLIA
            ? this.configService.get<string>('ARBITRUM_SEPOLIA_RPC_URL') ||
                'https://sepolia-rollup.arbitrum.io/rpc'
            : this.configService.get<string>('OPTIMISM_SEPOLIA_RPC_URL') ||
                'https://sepolia.optimism.io',
        ),
      });

      const erc2771Request: CallWithERC2771Request = {
        chainId: BigInt(this.chains[sourceNetwork].id),
        target: sourceContract.address as `0x${string}`,
        data: burnData as `0x${string}`,
        user: account.address,
      };

      const { taskId } = await this.gelatoRelay.sponsoredCallERC2771(
        erc2771Request,
        walletClient,
        apiKey,
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
