import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ethers } from 'ethers';
import {
  GelatoRelay,
  TaskState,
  CallWithERC2771Request,
} from '@gelatonetwork/relay-sdk-viem';
import { PrismaService } from '../prisma/prisma.service';
import { Network, TransactionStatus } from '../types';
import { getChainId } from '../utils';
import MockERC20Abi from '../contracts/abi/MockERC20.json';
import { createWalletClient, http, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia, optimismSepolia } from 'viem/chains';

export interface GelatoStatusJobData {
  taskId: string;
  transactionId: string;
  targetNetwork: Network;
  retryCount: number;
  maxRetries: number;
  recoveryAttempt: number;
}

export interface GelatoRecoveryJobData {
  transactionId: string;
  sourceTransactionHash: string;
  amount: string;
  recipient: string;
  sourceNetwork: Network;
  targetNetwork: Network;
  recoveryAttempt: number;
  burnId: string;
}

const MAX_RECOVERY_ATTEMPTS = 3;

@Processor('gelato-status')
export class GelatoStatusProcessor {
  private readonly logger = new Logger(GelatoStatusProcessor.name);
  private readonly gelatoRelay: GelatoRelay;
  private readonly contracts: Record<Network, ethers.Contract>;
  private readonly chains: Record<Network, Chain>;
  private readonly providers: Record<Network, ethers.providers.JsonRpcProvider>;

  private readonly rateLimitWindow = 60000; // 1 minute
  private readonly maxRequestsPerWindow = 10; // Maximum requests per minute
  private requestTimestamps: number[] = [];

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    @InjectQueue('gelato-status') private gelatoStatusQueue: Queue,
    @InjectQueue('gelato-recovery') private gelatoRecoveryQueue: Queue,
  ) {
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

    const apiKey = this.configService.get<string>('GELATO_API_KEY') || '';
    if (!apiKey) {
      throw new Error('Gelato API key not configured');
    }

    this.chains = {
      [Network.ARBITRUM_SEPOLIA]: arbitrumSepolia,
      [Network.OPTIMISM_SEPOLIA]: optimismSepolia,
    };

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
  }

  @Process('check-status')
  async checkGelatoTaskStatus(job: Job<GelatoStatusJobData>): Promise<void> {
    const {
      taskId,
      transactionId,
      targetNetwork,
      retryCount,
      maxRetries,
      recoveryAttempt,
    } = job.data;

    try {
      if (!this.canMakeRequest()) {
        this.logger.warn(
          `Rate limit reached, delaying Gelato status check for task ${taskId}`,
        );
        const delay = Math.min(5000 * Math.pow(2, retryCount), 300000); // Max 5 minutes
        await this.gelatoStatusQueue.add('check-status', job.data, {
          delay,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        });
        return;
      }

      this.trackRequest();

      const status = await this.gelatoRelay.getTaskStatus(taskId);
      this.logger.log(`Gelato task ${taskId} status: ${status?.taskState}`);

      if (!status) {
        if (retryCount < maxRetries) {
          // Re-queue with incremented retry count
          await this.queueNextStatusCheck(
            taskId,
            transactionId,
            targetNetwork,
            retryCount,
            maxRetries,
            recoveryAttempt,
          );
        } else {
          await this.handleFailedTransaction(
            transactionId,
            `Max retries reached for task ${taskId}`,
            recoveryAttempt,
          );
        }
        return;
      }

      const taskState = status.taskState as TaskState;

      if (taskState === TaskState.ExecSuccess) {
        const transaction = await this.prisma.bridgeTransaction.findUnique({
          where: { id: transactionId },
        });

        if (transaction) {
          await this.prisma.bridgeTransaction.update({
            where: { id: transaction.id },
            data: {
              status: TransactionStatus.COMPLETED,
              gelatoTaskId: taskId,
              targetTransactionHash: status.transactionHash || '',
            },
          });
        }

        this.logger.log(
          `Bridge transaction completed: ${status.transactionHash || 'unknown'}`,
        );
        return;
      }

      const failedStates = [TaskState.ExecReverted, TaskState.Cancelled];

      if (failedStates.includes(taskState)) {
        let errorMessage = `Task failed with state: ${taskState}`;
        if (status.lastCheckMessage) {
          errorMessage += ` - ${status.lastCheckMessage}`;
        }

        await this.handleFailedTransaction(
          transactionId,
          errorMessage,
          recoveryAttempt,
        );
        return;
      }

      const pendingStates = [
        TaskState.WaitingForConfirmation,
        TaskState.CheckPending,
        TaskState.ExecPending,
      ];

      if (pendingStates.includes(taskState)) {
        if (retryCount < maxRetries) {
          await this.queueNextStatusCheck(
            taskId,
            transactionId,
            targetNetwork,
            retryCount,
            maxRetries,
            recoveryAttempt,
          );
        } else {
          await this.handleFailedTransaction(
            transactionId,
            `Max retries reached for task ${taskId}`,
            recoveryAttempt,
          );
        }
        return;
      }

      this.logger.warn(`Unknown task state: ${taskState} for task ${taskId}`);
      if (retryCount < maxRetries) {
        await this.queueNextStatusCheck(
          taskId,
          transactionId,
          targetNetwork,
          retryCount,
          maxRetries,
          recoveryAttempt,
        );
      } else {
        await this.handleFailedTransaction(
          transactionId,
          `Max retries reached for task ${taskId}`,
          recoveryAttempt,
        );
      }
    } catch (error) {
      this.logger.error(`Error polling Gelato task status: ${error.message}`);

      if (retryCount < maxRetries) {
        await this.queueNextStatusCheck(
          taskId,
          transactionId,
          targetNetwork,
          retryCount,
          maxRetries,
          recoveryAttempt,
        );
      } else {
        await this.handleFailedTransaction(
          transactionId,
          `Error after max retries: ${error.message}`,
          recoveryAttempt,
        );
      }
    }
  }

  @Process('recovery')
  async recoverFailedTransaction(
    job: Job<GelatoRecoveryJobData>,
  ): Promise<void> {
    const { transactionId, amount, recipient, targetNetwork, recoveryAttempt } =
      job.data;

    try {
      this.logger.log(
        `Attempting recovery for transaction ${transactionId} (attempt ${recoveryAttempt})`,
      );

      const transaction = await this.prisma.bridgeTransaction.findUnique({
        where: { id: transactionId },
      });

      if (!transaction || transaction.status !== TransactionStatus.FAILED) {
        this.logger.log(
          `Transaction ${transactionId} is no longer in FAILED status, skipping recovery`,
        );
        return;
      }

      await this.prisma.bridgeTransaction.update({
        where: { id: transaction.id },
        data: { status: TransactionStatus.RECOVERY_IN_PROGRESS },
      });

      // Check the rate limit
      if (!this.canMakeRequest()) {
        this.logger.warn(
          `Rate limit reached, delaying recovery for transaction ${transactionId}`,
        );
        const delay = Math.min(30000 * Math.pow(2, recoveryAttempt), 3600000); // Max 1 hour
        await this.gelatoRecoveryQueue.add('recovery', job.data, {
          delay,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 30000,
          },
        });
        return;
      }

      this.trackRequest();

      const contract = this.contracts[targetNetwork];

      const burnId =
        job.data.burnId ||
        `0x${Buffer.from(
          ethers.utils
            .solidityKeccak256(
              ['address', 'uint256', 'uint256', 'string'],
              [recipient, amount, Date.now(), 'recovery'],
            )
            .slice(2),
          'hex',
        ).toString('hex')}`;

      this.logger.log(`Using burnId for recovery: ${burnId}`);

      const mintData = contract.interface.encodeFunctionData('mint', [
        recipient,
        amount,
        burnId,
      ]);

      const targetContractAddress = this.configService.get<string>(
        targetNetwork === Network.ARBITRUM_SEPOLIA
          ? 'ARBITRUM_ERC20_ADDRESS'
          : 'OPTIMISM_ERC20_ADDRESS',
      );

      const request = {
        chainId: getChainId(targetNetwork),
        target: targetContractAddress || '',
        data: mintData,
      };

      const apiKey = this.configService.get<string>('GELATO_API_KEY') || '';

      this.logger.log(
        `Sending recovery sponsoredCall to Gelato Relay for network ${targetNetwork}...`,
      );

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

      await this.prisma.bridgeTransaction.update({
        where: { id: transaction.id },
        data: {
          gelatoTaskId: taskId,
          recoveryAttempts: (transaction.recoveryAttempts || 0) + 1,
        },
      });

      this.logger.log(`Recovery Gelato task created with ID: ${taskId}`);

      await this.gelatoStatusQueue.add(
        'check-status',
        {
          taskId,
          transactionId,
          targetNetwork,
          retryCount: 0,
          maxRetries: 30,
          recoveryAttempt: recoveryAttempt + 1,
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
      this.logger.error(`Error during recovery attempt: ${error.message}`);

      const transaction = await this.prisma.bridgeTransaction.findUnique({
        where: { id: transactionId },
      });

      if (transaction) {
        await this.prisma.bridgeTransaction.update({
          where: { id: transaction.id },
          data: {
            status: TransactionStatus.FAILED,
            recoveryAttempts: (transaction.recoveryAttempts || 0) + 1,
          },
        });
      }

      if (recoveryAttempt < MAX_RECOVERY_ATTEMPTS) {
        const delay = 60000 * Math.pow(2, recoveryAttempt);
        await this.gelatoRecoveryQueue.add(
          'recovery',
          {
            ...job.data,
            recoveryAttempt: recoveryAttempt + 1,
          },
          {
            delay,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 30000,
            },
          },
        );
      } else {
        this.logger.error(
          `Max recovery attempts reached for transaction ${transactionId}`,
        );
      }
    }
  }

  private async queueNextStatusCheck(
    taskId: string,
    transactionId: string,
    targetNetwork: Network,
    retryCount: number,
    maxRetries: number,
    recoveryAttempt: number,
  ): Promise<void> {
    const baseDelay = 10000;
    const delay = Math.min(baseDelay * Math.pow(1.5, retryCount), 300000); // Max 5 minutes

    await this.gelatoStatusQueue.add(
      'check-status',
      {
        taskId,
        transactionId,
        targetNetwork,
        retryCount: retryCount + 1,
        maxRetries,
        recoveryAttempt,
      },
      {
        delay,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    );
  }

  private async handleFailedTransaction(
    transactionId: string,
    reason: string,
    recoveryAttempt: number = 0,
  ): Promise<void> {
    try {
      this.logger.log(
        `Handling failed transaction ${transactionId}: ${reason}`,
      );

      const transaction = await this.prisma.bridgeTransaction.findUnique({
        where: { id: transactionId },
      });

      if (!transaction) {
        this.logger.error(`Transaction ${transactionId} not found`);
        return;
      }

      // Update transaction status to FAILED
      await this.prisma.bridgeTransaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.FAILED,
        },
      });

      this.logger.error(`Transaction ${transactionId} failed: ${reason}`);

      // Only attempt recovery if we haven't exceeded max attempts
      if (recoveryAttempt < MAX_RECOVERY_ATTEMPTS) {
        this.logger.log(
          `Scheduling recovery for transaction ${transactionId} (attempt ${recoveryAttempt + 1})`,
        );

        const burnId =
          transaction.burnId ||
          `0x${Buffer.from(
            ethers.utils
              .solidityKeccak256(
                ['address', 'uint256', 'uint256', 'string'],
                [
                  transaction.recipient,
                  transaction.amount,
                  Date.now(),
                  'recovery',
                ],
              )
              .slice(2),
            'hex',
          ).toString('hex')}`;

        await this.gelatoRecoveryQueue.add(
          'recovery',
          {
            transactionId: transaction.id,
            sourceTransactionHash: transaction.sourceTransactionHash || '',
            amount: transaction.amount,
            recipient: transaction.recipient,
            sourceNetwork: transaction.sourceNetwork as Network,
            targetNetwork: transaction.targetNetwork as Network,
            recoveryAttempt: recoveryAttempt + 1,
            burnId: burnId,
          },
          {
            delay: 30000,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 30000,
            },
          },
        );

        this.logger.log(
          `Queued recovery job for transaction ${transactionId} with burnId ${burnId}`,
        );
      } else {
        this.logger.error(
          `Max recovery attempts reached for transaction ${transactionId}`,
        );
      }
    } catch (error) {
      this.logger.error(`Error handling failed transaction: ${error.message}`);
    }
  }

  private canMakeRequest(): boolean {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter(
      (timestamp) => now - timestamp < this.rateLimitWindow,
    );

    return this.requestTimestamps.length < this.maxRequestsPerWindow;
  }

  private trackRequest(): void {
    this.requestTimestamps.push(Date.now());
  }
}
