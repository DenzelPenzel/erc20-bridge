import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ethers } from 'ethers';
import {
  GelatoRelay,
  CallWithERC2771Request,
} from '@gelatonetwork/relay-sdk-viem';
import { PrismaService } from '../prisma/prisma.service';
import { BridgeRequest, Network, TransactionStatus } from '../types';
import MockERC20Abi from '../contracts/abi/MockERC20.json';
import { getChainId } from '../utils';
import { createWalletClient, http, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia, optimismSepolia } from 'viem/chains';

@Processor('bridge')
export class BridgeProcessor {
  private readonly logger = new Logger(BridgeProcessor.name);
  private readonly gelatoRelay: GelatoRelay;
  private readonly providers: Record<Network, ethers.providers.JsonRpcProvider>;
  private readonly contracts: Record<Network, ethers.Contract>;
  private readonly chains: Record<Network, Chain>;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    @InjectQueue('gelato-status') private gelatoStatusQueue: Queue,
  ) {
    const apiKey = this.configService.get<string>('GELATO_API_KEY') || '';
    if (!apiKey) {
      throw new Error('Gelato API key not configured');
    }

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

    this.chains = {
      [Network.ARBITRUM_SEPOLIA]: arbitrumSepolia,
      [Network.OPTIMISM_SEPOLIA]: optimismSepolia,
    };

    this.providers = {
      [Network.ARBITRUM_SEPOLIA]: new ethers.providers.JsonRpcProvider(
        this.configService.get<string>('ARBITRUM_SEPOLIA_RPC_URL'),
      ),
      [Network.OPTIMISM_SEPOLIA]: new ethers.providers.JsonRpcProvider(
        this.configService.get<string>('OPTIMISM_SEPOLIA_RPC_URL'),
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
  }

  @Process('processBurn')
  async processBurn(job: Job<BridgeRequest>): Promise<void> {
    this.logger.log(`Processing burn event: ${JSON.stringify(job.data)}`);

    try {
      const {
        recipient,
        amount,
        targetNetwork,
        sourceTransactionHash,
        burnId,
      } = job.data;

      const transaction = await this.prisma.bridgeTransaction.findFirst({
        where: { sourceTransactionHash },
      });

      if (!transaction) {
        this.logger.error(
          `Transaction not found for hash: ${sourceTransactionHash}`,
        );
        return;
      }

      await this.prisma.bridgeTransaction.update({
        where: { id: transaction.id },
        data: { status: TransactionStatus.PROCESSING },
      });

      const contract = this.contracts[targetNetwork];
      const mintData = contract.interface.encodeFunctionData('mint', [
        recipient,
        amount,
        burnId,
      ]);

      this.logger.log(
        `Using burnId: ${burnId} for minting tokens to ${recipient}`,
      );

      const request = {
        chainId: getChainId(targetNetwork),
        target: contract.address,
        data: mintData,
      };

      const apiKey = this.configService.get<string>('GELATO_API_KEY') || '';

      const privateKey = this.configService.get<string>('PRIVATE_KEY');

      const account = privateKeyToAccount(privateKey as `0x${string}`);

      const walletClient = createWalletClient({
        account,
        chain: this.chains[targetNetwork],
        transport: http(
          targetNetwork === Network.ARBITRUM_SEPOLIA
            ? this.configService.get<string>('ARBITRUM_SEPOLIA_RPC_URL') ||
                'https://sepolia-rollup.arbitrum.io/rpc'
            : this.configService.get<string>('OPTIMISM_SEPOLIA_RPC_URL') ||
                'https://sepolia.optimism.io',
        ),
      });

      const erc2771Request: CallWithERC2771Request = {
        chainId: BigInt(this.chains[targetNetwork].id),
        target: request.target as `0x${string}`,
        data: request.data as `0x${string}`,
        user: account.address,
      };

      const { taskId } = await this.gelatoRelay.sponsoredCallERC2771(
        erc2771Request,
        walletClient,
        apiKey,
      );

      this.logger.log(`Gelato task created with ID: ${taskId}`);

      await this.gelatoStatusQueue.add(
        'check-status',
        {
          taskId,
          transactionId: transaction.id,
          targetNetwork,
          retryCount: 0,
          maxRetries: 30,
          recoveryAttempt: 0,
        },
        {
          delay: 10000,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      );
    } catch (error) {
      this.logger.error(`Error processing burn event: ${error.message}`);

      const transaction = await this.prisma.bridgeTransaction.findFirst({
        where: { sourceTransactionHash: job.data.sourceTransactionHash },
      });

      if (transaction) {
        await this.prisma.bridgeTransaction.update({
          where: { id: transaction.id },
          data: { status: TransactionStatus.FAILED },
        });
      }

      throw error;
    }
  }
}
