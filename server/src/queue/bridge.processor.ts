import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ethers } from 'ethers';
import { GelatoRelay } from '@gelatonetwork/relay-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { BridgeRequest, Network, TransactionStatus } from '../types';
import MockERC20Abi from '../contracts/abi/MockERC20.json';
import { getChainId } from '../utils';

@Processor('bridge')
export class BridgeProcessor {
  private readonly logger = new Logger(BridgeProcessor.name);
  private readonly gelatoRelay: GelatoRelay;
  private readonly providers: Record<Network, ethers.providers.JsonRpcProvider>;
  private readonly contracts: Record<Network, ethers.Contract>;
  private readonly bridgeOperator: Record<Network, ethers.Wallet>;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    @InjectQueue('gelato-status') private gelatoStatusQueue: Queue,
  ) {
    const apiKey = this.configService.get<string>('GELATO_API_KEY') || '';
    if (!apiKey) {
      throw new Error('Gelato API key not configured');
    }

    this.gelatoRelay = new GelatoRelay();

    this.providers = {
      [Network.ARBITRUM_SEPOLIA]: new ethers.providers.JsonRpcProvider(
        this.configService.get<string>('ARBITRUM_SEPOLIA_RPC_URL'),
      ),
      [Network.OPTIMISM_SEPOLIA]: new ethers.providers.JsonRpcProvider(
        this.configService.get<string>('OPTIMISM_SEPOLIA_RPC_URL'),
      ),
    };

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

  @Process('processBurn')
  async processBurn(job: Job<BridgeRequest>): Promise<void> {
    this.logger.log(`Processing burn event: ${JSON.stringify(job.data)}`);

    try {
      const { recipient, amount, targetNetwork, sourceTransactionHash } =
        job.data;

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
      ]);

      const request = {
        chainId: getChainId(targetNetwork),
        target: contract.address,
        data: mintData,
      };

      const apiKey = this.configService.get<string>('GELATO_API_KEY') || '';

      const { taskId } = await this.gelatoRelay.sponsoredCall(request, apiKey, {
        retries: 3,
        gasLimit: BigInt(500000),
      });

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
    }
  }
}
