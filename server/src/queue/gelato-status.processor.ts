import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ethers } from 'ethers';
import { GelatoRelay, TaskState } from '@gelatonetwork/relay-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { Network, TransactionStatus } from '../types';
import { getChainId } from '../utils';
import MockERC20Abi from '../contracts/abi/MockERC20.json';

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
}

const MAX_RECOVERY_ATTEMPTS = 3;

@Processor('gelato-status')
export class GelatoStatusProcessor {
  private readonly logger = new Logger(GelatoStatusProcessor.name);
  private readonly gelatoRelay: GelatoRelay;
  private readonly contracts: Record<Network, ethers.Contract>;

  // Rate limiting settings
  private readonly rateLimitWindow = 60000; // 1 minute
  private readonly maxRequestsPerWindow = 1; // Maximum requests per minute
  private requestTimestamps: number[] = [];

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    @InjectQueue('gelato-status') private gelatoStatusQueue: Queue,
    @InjectQueue('gelato-recovery') private gelatoRecoveryQueue: Queue,
  ) {
    this.gelatoRelay = new GelatoRelay();

    const apiKey = this.configService.get<string>('GELATO_API_KEY') || '';
    if (!apiKey) {
      throw new Error('Gelato API key not configured');
    }

    this.contracts = {
      [Network.ARBITRUM_SEPOLIA]: new ethers.Contract(
        this.configService.get<string>('ARBITRUM_ERC20_ADDRESS') || '',
        MockERC20Abi,
      ),
      [Network.OPTIMISM_SEPOLIA]: new ethers.Contract(
        this.configService.get<string>('OPTIMISM_ERC20_ADDRESS') || '',
        MockERC20Abi,
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
      const mintData = contract.interface.encodeFunctionData('mint', [
        recipient,
        amount,
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

      const { taskId } = await this.gelatoRelay.sponsoredCall(request, apiKey, {
        retries: 3,
        gasLimit: BigInt(500000),
      });

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
    this.logger.error(`Bridge transaction failed: ${reason}`);

    const transaction = await this.prisma.bridgeTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      this.logger.error(`Transaction ${transactionId} not found`);
      return;
    }

    await this.prisma.bridgeTransaction.update({
      where: { id: transaction.id },
      data: { status: TransactionStatus.FAILED },
    });

    // If this wasn't already a recovery attempt
    // we haven't exceeded max recovery attempts
    if (recoveryAttempt < MAX_RECOVERY_ATTEMPTS) {
      await this.gelatoRecoveryQueue.add(
        'recovery',
        {
          transactionId: transaction.id,
          sourceTransactionHash: transaction.sourceTransactionHash,
          amount: transaction.amount,
          recipient: transaction.recipient,
          sourceNetwork: transaction.sourceNetwork,
          targetNetwork: transaction.targetNetwork,
          recoveryAttempt,
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

      this.logger.log(`Queued recovery job for transaction ${transactionId}`);
    } else {
      this.logger.error(
        `Max recovery attempts reached for transaction ${transactionId}`,
      );
    }
  }

  private canMakeRequest(): boolean {
    const now = Date.now();
    // Remove old requests
    this.requestTimestamps = this.requestTimestamps.filter(
      (timestamp) => now - timestamp < this.rateLimitWindow,
    );

    return this.requestTimestamps.length < this.maxRequestsPerWindow;
  }

  private trackRequest(): void {
    this.requestTimestamps.push(Date.now());
  }
}
