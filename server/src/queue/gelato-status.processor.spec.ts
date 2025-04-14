import { Test, TestingModule } from '@nestjs/testing';
import {
  GelatoStatusProcessor,
  GelatoStatusJobData,
  GelatoRecoveryJobData,
} from './gelato-status.processor';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bull';
import { Job } from 'bull';
import { GelatoRelay, TaskState } from '@gelatonetwork/relay-sdk';
import { Network, TransactionStatus } from '../types';
import { ethers } from 'ethers';

jest.mock('@gelatonetwork/relay-sdk', () => {
  const originalModule = jest.requireActual('@gelatonetwork/relay-sdk');
  return {
    ...originalModule,
    GelatoRelay: jest.fn().mockImplementation(() => ({
      getTaskStatus: jest.fn(),
      sponsoredCall: jest.fn(),
    })),
    TaskState: originalModule.TaskState,
  };
});

jest.mock('../utils', () => ({
  getChainId: jest.fn((network) => {
    if (network === 'arbitrumSepolia') return BigInt(421614);
    if (network === 'optimismSepolia') return BigInt(11155420);
    return BigInt(1);
  }),
  sleep: jest.fn((ms) => Promise.resolve()),
}));

jest.mock('ethers', () => {
  const mockProvider = {
    getNetwork: jest.fn().mockResolvedValue({ chainId: 1 }),
  };

  const mockInterface = {
    encodeFunctionData: jest.fn().mockReturnValue('0xmockdata'),
  };

  const mockContract = {
    interface: mockInterface,
    connect: jest.fn().mockReturnThis(),
    address: '0xMockAddress',
  };

  return {
    ethers: {
      providers: {
        JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
      },
      Contract: jest.fn().mockImplementation(() => mockContract),
    },
    Contract: jest.fn().mockImplementation(() => mockContract),
    providers: {
      JsonRpcProvider: jest.fn().mockImplementation(() => mockProvider),
    },
  };
});

describe('GelatoStatusProcessor', () => {
  let processor: GelatoStatusProcessor;
  let prismaService: PrismaService;
  let configService: ConfigService;
  let gelatoStatusQueue: any;
  let gelatoRecoveryQueue: any;
  let mockGelatoRelay: any;

  const mockPrismaService = {
    bridgeTransaction: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockConfigService = new ConfigService();
  jest.spyOn(mockConfigService, 'get').mockImplementation((key) => {
    const config = {
      GELATO_API_KEY: 'mock-api-key',
      ARBITRUM_ERC20_ADDRESS: '0xMockArbitrumAddress',
      OPTIMISM_ERC20_ADDRESS: '0xMockOptimismAddress',
    };
    return config[key] || '';
  });

  const mockGelatoStatusQueue = {
    add: jest.fn(),
  };

  const mockGelatoRecoveryQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: getQueueToken('gelato-status'),
          useValue: mockGelatoStatusQueue,
        },
        {
          provide: getQueueToken('gelato-recovery'),
          useValue: mockGelatoRecoveryQueue,
        },
      ],
    }).compile();

    prismaService = module.get<PrismaService>(PrismaService);
    configService = module.get<ConfigService>(ConfigService);
    gelatoStatusQueue = module.get(getQueueToken('gelato-status'));
    gelatoRecoveryQueue = module.get(getQueueToken('gelato-recovery'));

    processor = new GelatoStatusProcessor(
      prismaService,
      configService,
      gelatoStatusQueue,
      gelatoRecoveryQueue,
    );

    mockGelatoRelay = (GelatoRelay as jest.Mock).mock.results[0].value;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should throw an error if Gelato API key is not configured', () => {
      const emptyApiKeyConfig = new ConfigService();
      jest.spyOn(emptyApiKeyConfig, 'get').mockImplementation((key) => {
        if (key === 'GELATO_API_KEY') return '';
        if (key === 'ARBITRUM_ERC20_ADDRESS') return '0xMockArbitrumAddress';
        if (key === 'OPTIMISM_ERC20_ADDRESS') return '0xMockOptimismAddress';
        return '';
      });

      expect(() => {
        new GelatoStatusProcessor(
          prismaService,
          emptyApiKeyConfig,
          gelatoStatusQueue,
          gelatoRecoveryQueue,
        );
      }).toThrow('Gelato API key not configured');
    });

    it('should initialize contracts for both networks', () => {
      expect(ethers.Contract).toHaveBeenCalledTimes(2);
      expect(ethers.Contract).toHaveBeenCalledWith(
        '0xMockArbitrumAddress',
        expect.anything(),
      );
      expect(ethers.Contract).toHaveBeenCalledWith(
        '0xMockOptimismAddress',
        expect.anything(),
      );
    });
  });

  describe('checkGelatoTaskStatus', () => {
    const mockJob = {
      data: {
        taskId: 'mock-task-id',
        transactionId: 'mock-tx-id',
        targetNetwork: Network.ARBITRUM_SEPOLIA,
        retryCount: 0,
        maxRetries: 5,
        recoveryAttempt: 0,
      },
    } as Job<GelatoStatusJobData>;

    it('should handle rate limiting correctly', async () => {
      jest.spyOn(processor as any, 'canMakeRequest').mockReturnValueOnce(false);

      await processor.checkGelatoTaskStatus(mockJob);

      expect(gelatoStatusQueue.add).toHaveBeenCalledWith(
        'check-status',
        mockJob.data,
        expect.objectContaining({
          delay: expect.any(Number),
        }),
      );
      expect(mockGelatoRelay.getTaskStatus).not.toHaveBeenCalled();
    });

    it('should handle successful task completion', async () => {
      jest.spyOn(processor as any, 'canMakeRequest').mockReturnValueOnce(true);
      jest.spyOn(processor as any, 'trackRequest').mockImplementation();

      mockGelatoRelay.getTaskStatus.mockResolvedValueOnce({
        taskState: TaskState.ExecSuccess,
        transactionHash: 'mock-tx-hash',
      });

      mockPrismaService.bridgeTransaction.findUnique.mockResolvedValueOnce({
        id: 'mock-tx-id',
        status: TransactionStatus.PROCESSING,
      });

      await processor.checkGelatoTaskStatus(mockJob);

      expect(mockPrismaService.bridgeTransaction.update).toHaveBeenCalledWith({
        where: { id: 'mock-tx-id' },
        data: {
          status: TransactionStatus.COMPLETED,
          gelatoTaskId: 'mock-task-id',
          targetTransactionHash: 'mock-tx-hash',
        },
      });
    });

    it('should handle failed task execution', async () => {
      jest.spyOn(processor as any, 'canMakeRequest').mockReturnValueOnce(true);
      jest.spyOn(processor as any, 'trackRequest').mockImplementation();
      jest
        .spyOn(processor as any, 'handleFailedTransaction')
        .mockImplementation();

      mockGelatoRelay.getTaskStatus.mockResolvedValueOnce({
        taskState: TaskState.ExecReverted,
        lastCheckMessage: 'Transaction reverted',
      });

      await processor.checkGelatoTaskStatus(mockJob);

      expect(processor['handleFailedTransaction']).toHaveBeenCalledWith(
        'mock-tx-id',
        'Task failed with state: ExecReverted - Transaction reverted',
        0,
      );
    });

    it('should handle pending task states and queue next check', async () => {
      jest.spyOn(processor as any, 'canMakeRequest').mockReturnValueOnce(true);
      jest.spyOn(processor as any, 'trackRequest').mockImplementation();
      jest.spyOn(processor as any, 'queueNextStatusCheck').mockImplementation();

      mockGelatoRelay.getTaskStatus.mockResolvedValueOnce({
        taskState: TaskState.WaitingForConfirmation,
      });

      await processor.checkGelatoTaskStatus(mockJob);

      expect(processor['queueNextStatusCheck']).toHaveBeenCalledWith(
        'mock-task-id',
        'mock-tx-id',
        Network.ARBITRUM_SEPOLIA,
        0,
        5,
        0,
      );
    });

    it('should handle max retries reached', async () => {
      const jobWithMaxRetries = {
        data: {
          ...mockJob.data,
          retryCount: 5,
          maxRetries: 5,
        },
      } as Job<GelatoStatusJobData>;

      jest.spyOn(processor as any, 'canMakeRequest').mockReturnValueOnce(true);
      jest.spyOn(processor as any, 'trackRequest').mockImplementation();
      jest
        .spyOn(processor as any, 'handleFailedTransaction')
        .mockImplementation();

      mockGelatoRelay.getTaskStatus.mockResolvedValueOnce({
        taskState: TaskState.WaitingForConfirmation,
      });

      await processor.checkGelatoTaskStatus(jobWithMaxRetries);

      expect(processor['handleFailedTransaction']).toHaveBeenCalledWith(
        'mock-tx-id',
        'Max retries reached for task mock-task-id',
        0,
      );
    });

    it('should handle errors during task status check', async () => {
      jest.spyOn(processor as any, 'canMakeRequest').mockReturnValueOnce(true);
      jest.spyOn(processor as any, 'trackRequest').mockImplementation();
      jest.spyOn(processor as any, 'queueNextStatusCheck').mockImplementation();

      mockGelatoRelay.getTaskStatus.mockRejectedValueOnce(
        new Error('API error'),
      );

      await processor.checkGelatoTaskStatus(mockJob);

      expect(processor['queueNextStatusCheck']).toHaveBeenCalledWith(
        'mock-task-id',
        'mock-tx-id',
        Network.ARBITRUM_SEPOLIA,
        0,
        5,
        0,
      );
    });

    it('should handle errors after max retries', async () => {
      const jobWithMaxRetries = {
        data: {
          ...mockJob.data,
          retryCount: 5,
          maxRetries: 5,
        },
      } as Job<GelatoStatusJobData>;

      jest.spyOn(processor as any, 'canMakeRequest').mockReturnValueOnce(true);
      jest.spyOn(processor as any, 'trackRequest').mockImplementation();
      jest
        .spyOn(processor as any, 'handleFailedTransaction')
        .mockImplementation();

      mockGelatoRelay.getTaskStatus.mockRejectedValueOnce(
        new Error('API error'),
      );

      await processor.checkGelatoTaskStatus(jobWithMaxRetries);

      expect(processor['handleFailedTransaction']).toHaveBeenCalledWith(
        'mock-tx-id',
        'Error after max retries: API error',
        0,
      );
    });
  });

  describe('recoverFailedTransaction', () => {
    const mockJob = {
      data: {
        transactionId: 'mock-tx-id',
        sourceTransactionHash: 'mock-source-tx-hash',
        amount: '1000000000000000000',
        recipient: '0xMockRecipient',
        sourceNetwork: Network.OPTIMISM_SEPOLIA,
        targetNetwork: Network.ARBITRUM_SEPOLIA,
        recoveryAttempt: 0,
      },
    } as Job<GelatoRecoveryJobData>;

    it('should skip recovery if transaction is not in FAILED status', async () => {
      mockPrismaService.bridgeTransaction.findUnique.mockResolvedValueOnce({
        id: 'mock-tx-id',
        status: TransactionStatus.COMPLETED,
      });

      await processor.recoverFailedTransaction(mockJob);

      expect(mockPrismaService.bridgeTransaction.update).not.toHaveBeenCalled();
      expect(mockGelatoRelay.sponsoredCall).not.toHaveBeenCalled();
    });

    it('should handle rate limiting during recovery', async () => {
      mockPrismaService.bridgeTransaction.findUnique.mockResolvedValueOnce({
        id: 'mock-tx-id',
        status: TransactionStatus.FAILED,
      });

      mockPrismaService.bridgeTransaction.update.mockResolvedValueOnce({});

      jest.spyOn(processor as any, 'canMakeRequest').mockReturnValueOnce(false);

      await processor.recoverFailedTransaction(mockJob);

      expect(gelatoRecoveryQueue.add).toHaveBeenCalledWith(
        'recovery',
        mockJob.data,
        expect.objectContaining({
          delay: expect.any(Number),
        }),
      );
      expect(mockGelatoRelay.sponsoredCall).not.toHaveBeenCalled();
    });

    it('should successfully create a recovery task', async () => {
      mockPrismaService.bridgeTransaction.findUnique.mockResolvedValueOnce({
        id: 'mock-tx-id',
        status: TransactionStatus.FAILED,
        recoveryAttempts: 0,
      });

      mockPrismaService.bridgeTransaction.update.mockResolvedValue({});

      jest.spyOn(processor as any, 'canMakeRequest').mockReturnValueOnce(true);
      jest.spyOn(processor as any, 'trackRequest').mockImplementation();

      mockGelatoRelay.sponsoredCall.mockResolvedValueOnce({
        taskId: 'mock-recovery-task-id',
      });

      await processor.recoverFailedTransaction(mockJob);

      expect(mockPrismaService.bridgeTransaction.update).toHaveBeenCalledWith({
        where: { id: 'mock-tx-id' },
        data: { status: TransactionStatus.RECOVERY_IN_PROGRESS },
      });

      expect(mockGelatoRelay.sponsoredCall).toHaveBeenCalledWith(
        {
          chainId: 421614n,
          target: '0xMockArbitrumAddress',
          data: '0xmockdata',
        },
        'mock-api-key',
        {
          retries: 3,
          gasLimit: BigInt(500000),
        },
      );

      expect(mockPrismaService.bridgeTransaction.update).toHaveBeenCalledWith({
        where: { id: 'mock-tx-id' },
        data: {
          gelatoTaskId: 'mock-recovery-task-id',
          recoveryAttempts: 1,
        },
      });

      expect(gelatoStatusQueue.add).toHaveBeenCalledWith(
        'check-status',
        expect.objectContaining({
          taskId: 'mock-recovery-task-id',
          transactionId: 'mock-tx-id',
          targetNetwork: Network.ARBITRUM_SEPOLIA,
          retryCount: 0,
          maxRetries: 30,
          recoveryAttempt: 1,
        }),
        expect.any(Object),
      );
    });

    it('should handle errors during recovery and retry if under max attempts', async () => {
      mockPrismaService.bridgeTransaction.findUnique.mockResolvedValueOnce({
        id: 'mock-tx-id',
        status: TransactionStatus.FAILED,
        recoveryAttempts: 0,
      });

      jest.spyOn(processor as any, 'canMakeRequest').mockReturnValueOnce(true);
      jest.spyOn(processor as any, 'trackRequest').mockImplementation();

      mockGelatoRelay.sponsoredCall.mockRejectedValueOnce(
        new Error('Relay error'),
      );

      await processor.recoverFailedTransaction(mockJob);

      expect(mockPrismaService.bridgeTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mock-tx-id' },
          data: { status: TransactionStatus.RECOVERY_IN_PROGRESS },
        }),
      );

      expect(gelatoRecoveryQueue.add).toHaveBeenCalledWith(
        'recovery',
        {
          ...mockJob.data,
          recoveryAttempt: 1,
        },
        expect.objectContaining({
          delay: expect.any(Number),
        }),
      );
    });

    it('should not retry recovery if max attempts reached', async () => {
      const jobWithMaxAttempts = {
        data: {
          ...mockJob.data,
          recoveryAttempt: 3,
        },
      } as Job<GelatoRecoveryJobData>;

      mockPrismaService.bridgeTransaction.findUnique.mockResolvedValueOnce({
        id: 'mock-tx-id',
        status: TransactionStatus.FAILED,
        recoveryAttempts: 3,
      });

      jest.spyOn(processor as any, 'canMakeRequest').mockReturnValueOnce(true);
      jest.spyOn(processor as any, 'trackRequest').mockImplementation();

      mockGelatoRelay.sponsoredCall.mockRejectedValueOnce(
        new Error('Relay error'),
      );

      await processor.recoverFailedTransaction(jobWithMaxAttempts);

      // update was called with RECOVERY_IN_PROGRESS
      expect(mockPrismaService.bridgeTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mock-tx-id' },
          data: { status: TransactionStatus.RECOVERY_IN_PROGRESS },
        }),
      );

      // Check recovery was NOT re-queued
      expect(gelatoRecoveryQueue.add).not.toHaveBeenCalledWith(
        'recovery',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('queueNextStatusCheck', () => {
    it('should queue the next status check with incremented retry count', async () => {
      await processor['queueNextStatusCheck'](
        'mock-task-id',
        'mock-tx-id',
        Network.ARBITRUM_SEPOLIA,
        1,
        5,
        0,
      );

      expect(gelatoStatusQueue.add).toHaveBeenCalledWith(
        'check-status',
        {
          taskId: 'mock-task-id',
          transactionId: 'mock-tx-id',
          targetNetwork: Network.ARBITRUM_SEPOLIA,
          retryCount: 2,
          maxRetries: 5,
          recoveryAttempt: 0,
        },
        expect.objectContaining({
          delay: expect.any(Number),
          attempts: 3,
        }),
      );
    });

    it('should calculate exponential backoff delay correctly', async () => {
      await processor['queueNextStatusCheck'](
        'mock-task-id',
        'mock-tx-id',
        Network.ARBITRUM_SEPOLIA,
        0,
        5,
        0,
      );

      expect(gelatoStatusQueue.add).toHaveBeenCalledWith(
        'check-status',
        expect.anything(),
        expect.objectContaining({
          delay: 10000,
        }),
      );

      await processor['queueNextStatusCheck'](
        'mock-task-id',
        'mock-tx-id',
        Network.ARBITRUM_SEPOLIA,
        3,
        5,
        0,
      );

      expect(gelatoStatusQueue.add).toHaveBeenCalledWith(
        'check-status',
        expect.anything(),
        expect.objectContaining({
          delay: 33750,
        }),
      );

      // Test max delay cap
      await processor['queueNextStatusCheck'](
        'mock-task-id',
        'mock-tx-id',
        Network.ARBITRUM_SEPOLIA,
        20,
        25,
        0,
      );

      expect(gelatoStatusQueue.add).toHaveBeenCalledWith(
        'check-status',
        expect.anything(),
        expect.objectContaining({
          delay: 300000,
        }),
      );
    });
  });

  describe('handleFailedTransaction', () => {
    it('should update transaction status to FAILED', async () => {
      mockPrismaService.bridgeTransaction.findUnique.mockResolvedValueOnce({
        id: 'mock-tx-id',
        status: TransactionStatus.PROCESSING,
        sourceTransactionHash: 'mock-source-tx-hash',
        amount: '1000000000000000000',
        recipient: '0xMockRecipient',
        sourceNetwork: Network.OPTIMISM_SEPOLIA,
        targetNetwork: Network.ARBITRUM_SEPOLIA,
      });

      await processor['handleFailedTransaction'](
        'mock-tx-id',
        'Test failure reason',
      );

      expect(mockPrismaService.bridgeTransaction.update).toHaveBeenCalledWith({
        where: { id: 'mock-tx-id' },
        data: { status: TransactionStatus.FAILED },
      });
    });

    it('should queue a recovery job if under max recovery attempts', async () => {
      mockPrismaService.bridgeTransaction.findUnique.mockResolvedValueOnce({
        id: 'mock-tx-id',
        status: TransactionStatus.PROCESSING,
        sourceTransactionHash: 'mock-source-tx-hash',
        amount: '1000000000000000000',
        recipient: '0xMockRecipient',
        sourceNetwork: Network.OPTIMISM_SEPOLIA,
        targetNetwork: Network.ARBITRUM_SEPOLIA,
      });

      await processor['handleFailedTransaction'](
        'mock-tx-id',
        'Test failure reason',
        1,
      );

      expect(gelatoRecoveryQueue.add).toHaveBeenCalledWith(
        'recovery',
        {
          transactionId: 'mock-tx-id',
          sourceTransactionHash: 'mock-source-tx-hash',
          amount: '1000000000000000000',
          recipient: '0xMockRecipient',
          sourceNetwork: Network.OPTIMISM_SEPOLIA,
          targetNetwork: Network.ARBITRUM_SEPOLIA,
          recoveryAttempt: 1,
        },
        expect.objectContaining({
          delay: 30000,
          attempts: 3,
        }),
      );
    });

    it('should not queue a recovery job if max recovery attempts reached', async () => {
      mockPrismaService.bridgeTransaction.findUnique.mockResolvedValueOnce({
        id: 'mock-tx-id',
        status: TransactionStatus.PROCESSING,
        sourceTransactionHash: 'mock-source-tx-hash',
        amount: '1000000000000000000',
        recipient: '0xMockRecipient',
        sourceNetwork: Network.OPTIMISM_SEPOLIA,
        targetNetwork: Network.ARBITRUM_SEPOLIA,
      });

      await processor['handleFailedTransaction'](
        'mock-tx-id',
        'Test failure reason',
        3,
      );

      expect(gelatoRecoveryQueue.add).not.toHaveBeenCalled();
    });

    it('should handle transaction not found', async () => {
      mockPrismaService.bridgeTransaction.findUnique.mockResolvedValueOnce(
        null,
      );

      await processor['handleFailedTransaction'](
        'mock-tx-id',
        'Test failure reason',
      );

      expect(mockPrismaService.bridgeTransaction.update).not.toHaveBeenCalled();
      expect(gelatoRecoveryQueue.add).not.toHaveBeenCalled();
    });
  });
});
