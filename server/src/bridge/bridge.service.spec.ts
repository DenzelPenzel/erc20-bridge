import { Test, TestingModule } from '@nestjs/testing';
import { BridgeService } from './bridge.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { Network, TransactionStatus } from '../types';
import { GelatoRelay } from '@gelatonetwork/relay-sdk-viem';
import { ethers } from 'ethers';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia, optimismSepolia } from 'viem/chains';
import { createWalletClient, http } from 'viem';

jest.mock('@gelatonetwork/relay-sdk-viem');
jest.mock('ethers');
jest.mock('viem/accounts');
jest.mock('viem', () => ({
  createWalletClient: jest.fn(),
  http: jest.fn(),
  createPublicClient: jest.fn(),
  parseAbi: jest.fn(),
  encodeFunctionData: jest.fn(),
  parseEther: jest.fn(),
}));

describe('BridgeService', () => {
  let service: BridgeService;
  let prismaService: PrismaService;
  let configService: ConfigService;
  let mockGelatoSponsoredCallERC2771: jest.SpyInstance;
  let mockWalletClient: any;

  const mockTransactions = [
    {
      id: '1',
      recipient: '0xUser',
      amount: '1.0',
      sourceNetwork: Network.ARBITRUM_SEPOLIA,
      targetNetwork: Network.OPTIMISM_SEPOLIA,
      status: TransactionStatus.COMPLETED,
      taskId: 'task-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '2',
      recipient: '0xUser',
      amount: '2.0',
      sourceNetwork: Network.OPTIMISM_SEPOLIA,
      targetNetwork: Network.ARBITRUM_SEPOLIA,
      status: TransactionStatus.PROCESSING,
      taskId: 'task-2',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();

    jest.spyOn(ethers.utils, 'isAddress').mockReturnValue(true);
    jest.spyOn(ethers.utils, 'parseEther').mockImplementation(
      () =>
        ({
          toString: () => '1000000000000000000',
          lte: jest.fn().mockReturnValue(false),
        }) as any,
    );

    // Mock wallet client
    mockWalletClient = {
      sendTransaction: jest.fn(),
      account: {
        address: '0xDummyAddress',
      },
    };

    // Mock the Gelato Relay sponsoredCallERC2771 method
    mockGelatoSponsoredCallERC2771 = jest
      .fn()
      .mockResolvedValue({ taskId: 'mock-task-id' });
    (GelatoRelay.prototype as any).sponsoredCallERC2771 =
      mockGelatoSponsoredCallERC2771;

    // Mock createWalletClient to return our mockWalletClient
    (createWalletClient as jest.Mock).mockReturnValue(mockWalletClient);
    (http as jest.Mock).mockReturnValue('http-transport');

    // Mock privateKeyToAccount
    (privateKeyToAccount as jest.Mock).mockReturnValue({
      address: '0xBridgeOperatorAddress',
      signMessage: jest.fn(),
      signTransaction: jest.fn(),
    });

    const mockContract = {
      address: '0xMockContractAddress',
      interface: {
        encodeFunctionData: jest.fn().mockReturnValue('0xMockEncodedData'),
      },
    };
    jest
      .spyOn(ethers, 'Contract')
      .mockImplementation(() => mockContract as any);

    const mockPrismaService = {
      bridgeTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'mock-tx-id' }),
        findMany: jest.fn().mockResolvedValue(mockTransactions),
        count: jest.fn().mockResolvedValue(mockTransactions.length),
      },
    };

    const mockConfigValues = {
      GELATO_API_KEY: 'mock-api-key',
      PRIVATE_KEY:
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      BRIDGE_OPERATOR_ADDRESS: '0xBridgeOperatorAddress',
      ARBITRUM_SEPOLIA_RPC_URL: 'https://sepolia-rollup.arbitrum.io/rpc',
      OPTIMISM_SEPOLIA_RPC_URL: 'https://sepolia.optimism.io',
      ARBITRUM_ERC20_ADDRESS: '0xArbitrumERC20Address',
      OPTIMISM_ERC20_ADDRESS: '0xOptimismERC20Address',
    };

    const mockConfigService = {
      get: jest.fn((key: string) => mockConfigValues[key]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BridgeService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<BridgeService>(BridgeService);
    prismaService = module.get<PrismaService>(PrismaService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('getUserTransactions', () => {
    it('should return user transactions with pagination', async () => {
      const result = await service.getUserTransactions('0xUser', 10, 0);

      expect(result).toEqual({
        transactions: mockTransactions,
        pagination: {
          total: mockTransactions.length,
          limit: 10,
          offset: 0,
          hasMore: false,
        },
      });

      expect(prismaService.bridgeTransaction.findMany).toHaveBeenCalledWith({
        where: { recipient: '0xUser' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 0,
      });
    });

    it('should filter transactions by status when provided', async () => {
      await service.getUserTransactions('0xUser', 10, 0, [
        TransactionStatus.PENDING,
      ]);

      expect(prismaService.bridgeTransaction.findMany).toHaveBeenCalledWith({
        where: {
          recipient: '0xUser',
          status: { in: [TransactionStatus.PENDING] },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 0,
      });
    });
  });

  describe('processBridgeRequest', () => {
    const mockRecipient = '0xMockRecipient';
    const mockAmount = '1.0';

    it('should throw if source and target networks are the same', async () => {
      await expect(
        service.processBridgeRequest(
          mockRecipient,
          mockAmount,
          Network.ARBITRUM_SEPOLIA,
          Network.ARBITRUM_SEPOLIA,
        ),
      ).rejects.toThrow('Source and target networks must be different');
    });

    it('should throw if recipient address is invalid', async () => {
      jest.spyOn(ethers.utils, 'isAddress').mockReturnValueOnce(false);

      await expect(
        service.processBridgeRequest(
          'invalid-address',
          mockAmount,
          Network.ARBITRUM_SEPOLIA,
          Network.OPTIMISM_SEPOLIA,
        ),
      ).rejects.toThrow('Invalid recipient address');
    });

    it('should throw if amount is invalid', async () => {
      jest.spyOn(ethers.utils, 'parseEther').mockImplementationOnce(() => {
        throw new Error('Invalid number');
      });

      await expect(
        service.processBridgeRequest(
          mockRecipient,
          'invalid-amount',
          Network.ARBITRUM_SEPOLIA,
          Network.OPTIMISM_SEPOLIA,
        ),
      ).rejects.toThrow(/Invalid amount/);
    });

    it('should throw if amount is zero or negative', async () => {
      jest.spyOn(ethers.utils, 'parseEther').mockImplementationOnce(
        () =>
          ({
            toString: () => '0',
            lte: jest.fn().mockReturnValue(true),
          }) as any,
      );

      await expect(
        service.processBridgeRequest(
          mockRecipient,
          '0',
          Network.ARBITRUM_SEPOLIA,
          Network.OPTIMISM_SEPOLIA,
        ),
      ).rejects.toThrow('Amount must be greater than 0');
    });

    it('should throw if Gelato API key is not configured', async () => {
      jest
        .spyOn(configService, 'get')
        .mockImplementation((key) =>
          key === 'GELATO_API_KEY' ? null : 'mock-value',
        );

      await expect(
        service.processBridgeRequest(
          mockRecipient,
          mockAmount,
          Network.ARBITRUM_SEPOLIA,
          Network.OPTIMISM_SEPOLIA,
        ),
      ).rejects.toThrow('Gelato API key is not configured');
    });

    it('should successfully process a bridge request from Arbitrum to Optimism', async () => {
      const result = await service.processBridgeRequest(
        mockRecipient,
        mockAmount,
        Network.ARBITRUM_SEPOLIA,
        Network.OPTIMISM_SEPOLIA,
      );

      expect(result).toEqual({
        taskId: 'mock-task-id',
        status: TransactionStatus.PROCESSING,
        message: 'Bridge transaction initiated successfully',
      });

      expect(createWalletClient).toHaveBeenCalledWith(
        expect.objectContaining({
          chain: arbitrumSepolia,
        }),
      );

      expect(mockGelatoSponsoredCallERC2771).toHaveBeenCalledWith(
        expect.objectContaining({
          chainId: BigInt(421614), // Arbitrum Sepolia
          target: '0xMockContractAddress',
          data: '0xMockEncodedData',
          user: '0xBridgeOperatorAddress',
        }),
        mockWalletClient,
        'mock-api-key',
      );
    });

    it('should successfully process a bridge request from Optimism to Arbitrum', async () => {
      const result = await service.processBridgeRequest(
        mockRecipient,
        mockAmount,
        Network.OPTIMISM_SEPOLIA,
        Network.ARBITRUM_SEPOLIA,
      );

      expect(result).toEqual({
        taskId: 'mock-task-id',
        status: TransactionStatus.PROCESSING,
        message: 'Bridge transaction initiated successfully',
      });

      expect(createWalletClient).toHaveBeenCalledWith(
        expect.objectContaining({
          chain: optimismSepolia,
        }),
      );

      expect(mockGelatoSponsoredCallERC2771).toHaveBeenCalledWith(
        expect.objectContaining({
          chainId: BigInt(11155420), // Optimism Sepolia
          user: '0xBridgeOperatorAddress',
        }),
        mockWalletClient,
        'mock-api-key',
      );
    });

    it('should handle Gelato API errors gracefully', async () => {
      mockGelatoSponsoredCallERC2771.mockRejectedValueOnce(
        new Error('Gelato API error'),
      );

      await expect(
        service.processBridgeRequest(
          mockRecipient,
          mockAmount,
          Network.ARBITRUM_SEPOLIA,
          Network.OPTIMISM_SEPOLIA,
        ),
      ).rejects.toThrow(
        'Failed to initiate bridge transaction: Gelato API error',
      );
    });
  });
});
