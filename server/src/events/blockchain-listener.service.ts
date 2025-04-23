import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ethers } from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { Network, TransactionStatus, BridgeRequest } from '../types';
import MockERC20Abi from '../contracts/abi/MockERC20.json';
import { Interval } from '@nestjs/schedule';

@Injectable()
export class BlockchainListenerService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainListenerService.name);
  private readonly providers: Record<Network, ethers.providers.JsonRpcProvider>;
  private readonly contracts: Record<Network, ethers.Contract>;
  private readonly providerHealthStatus: Record<Network, boolean> = {
    [Network.ARBITRUM_SEPOLIA]: true,
    [Network.OPTIMISM_SEPOLIA]: true,
  };
  private readonly reconnectAttempts: Record<Network, number> = {
    [Network.ARBITRUM_SEPOLIA]: 0,
    [Network.OPTIMISM_SEPOLIA]: 0,
  };
  private readonly usingBackupRpc: Record<Network, boolean> = {
    [Network.ARBITRUM_SEPOLIA]: false,
    [Network.OPTIMISM_SEPOLIA]: false,
  };
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly BASE_RECONNECT_DELAY = 5000; // 5 seconds

  constructor(
    private configService: ConfigService,
    @InjectQueue('bridge') private bridgeQueue: Queue,
    private prisma: PrismaService,
  ) {
    this.providers = {
      [Network.ARBITRUM_SEPOLIA]: new ethers.providers.JsonRpcProvider(
        this.configService.get<string>('RPC_ARBITRUMSEPOLIA'),
        'arbitrum-sepolia',
      ),
      [Network.OPTIMISM_SEPOLIA]: new ethers.providers.JsonRpcProvider(
        this.configService.get<string>('RPC_OPSEPOLIA'),
        'optimism-sepolia',
      ),
    };

    Object.values(this.providers).forEach(provider => {
      provider.pollingInterval = 15000;
      provider.getNetwork = provider.getNetwork.bind(provider);
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

  async onModuleInit() {
    this.logger.log('Starting blockchain event listeners');

    await this.initializeProviders();

    this.listenToEvents(Network.ARBITRUM_SEPOLIA);
    this.listenToEvents(Network.OPTIMISM_SEPOLIA);
  }

  private async initializeProviders() {
    for (const network of Object.values(Network)) {
      try {
        await Promise.race([
          this.providers[network].getBlockNumber(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Initial connection timeout')), 10000)
          )
        ]);
        this.logger.log(`Successfully connected to ${network} RPC endpoint`);
        this.providerHealthStatus[network] = true;
        this.reconnectAttempts[network] = 0;
        this.usingBackupRpc[network] = false;
      } catch (error) {
        this.logger.error(`Failed to connect to ${network} RPC endpoint: ${error.message}`);
        this.providerHealthStatus[network] = false;
        // Attempt to reconnect immediately
        this.reconnectProvider(network, 0);
      }
    }
  }

  @Interval(60000)
  async checkProvidersHealth() {
    this.logger.debug('Running provider health check');

    for (const network of Object.values(Network)) {
      if (!this.providerHealthStatus[network]) {
        this.logger.log(`Provider for ${network} is unhealthy, skipping health check`);
        continue;
      }

      try {
        await Promise.race([
          this.providers[network].getBlockNumber(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), 10000)
          )
        ]);

        this.logger.debug(`Health check passed for ${network}`);

        if (this.usingBackupRpc[network] && Math.random() < 0.2) {
          this.logger.log(`Attempting to switch back to primary RPC for ${network}`);
          this.usingBackupRpc[network] = false;
          this.reconnectProvider(network, 0);
        }
      } catch (error) {
        this.logger.warn(`Health check failed for ${network}: ${error.message}`);
        this.providerHealthStatus[network] = false;
        this.reconnectProvider(network, 0);
      }
    }
  }

  private listenToEvents(network: Network) {
    const provider = this.providers[network];
    const contract = this.contracts[network];
    let lastProcessedBlock = 0;

    provider.on('error', (error) => {
      this.logger.error(`Provider error on ${network}: ${error.message}`);
      this.providerHealthStatus[network] = false;
      this.reconnectProvider(network, lastProcessedBlock);
    });

    provider.on('disconnect', (code, reason) => {
      this.logger.warn(
        `Provider disconnected on ${network}: ${reason} (${code})`,
      );
      this.providerHealthStatus[network] = false;
      this.reconnectProvider(network, lastProcessedBlock);
    });

    this.setupBurnEventListener(contract, network, (blockNumber) => {
      lastProcessedBlock = Math.max(lastProcessedBlock, blockNumber);
    });

    this.setupMintEventListener(contract, network, (blockNumber) => {
      lastProcessedBlock = Math.max(lastProcessedBlock, blockNumber);
    });

    // track latest block
    provider.on('block', (blockNumber: number) => {
      lastProcessedBlock = blockNumber;
    });

    this.logger.log(`Started listening to events on ${network}`);
  }

  private async reconnectProvider(network: Network, lastKnownBlock: number) {
    if (this.reconnectAttempts[network] >= this.MAX_RECONNECT_ATTEMPTS) {
      const resetDelay = 60000; // 1 minute
      this.logger.warn(
        `Max reconnection attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached for ${network}, waiting ${resetDelay / 1000}s before trying again`,
      );
      setTimeout(() => {
        this.reconnectAttempts[network] = 0;
        this.reconnectProvider(network, lastKnownBlock);
      }, resetDelay);
      return;
    }

    const attempt = this.reconnectAttempts[network];
    const delay = Math.min(
      this.BASE_RECONNECT_DELAY * Math.pow(2, attempt),
      60000 // Max 1 minute delay
    );

    this.logger.log(`Attempting to reconnect provider for ${network} (attempt ${attempt + 1})...`);
    this.reconnectAttempts[network]++;

    try {
      const useBackup = this.reconnectAttempts[network] >= 3 && !this.usingBackupRpc[network];

      let rpcUrl;
      if (useBackup) {
        rpcUrl = network === Network.ARBITRUM_SEPOLIA
          ? this.configService.get<string>('RPC_ARBITRUMSEPOLIA_BACKUP')
          : this.configService.get<string>('RPC_OPSEPOLIA_BACKUP');
        this.logger.log(`Switching to backup RPC endpoint for ${network}: ${rpcUrl}`);
        this.usingBackupRpc[network] = true;
      } else if (this.usingBackupRpc[network]) {
        rpcUrl = network === Network.ARBITRUM_SEPOLIA
          ? this.configService.get<string>('RPC_ARBITRUMSEPOLIA_BACKUP')
          : this.configService.get<string>('RPC_OPSEPOLIA_BACKUP');
      } else {
        rpcUrl = network === Network.ARBITRUM_SEPOLIA
          ? this.configService.get<string>('RPC_ARBITRUMSEPOLIA')
          : this.configService.get<string>('RPC_OPSEPOLIA');
      }

      const networkName = network === Network.ARBITRUM_SEPOLIA
        ? 'arbitrum-sepolia'
        : 'optimism-sepolia';

      const newProvider = new ethers.providers.JsonRpcProvider(
        rpcUrl,
        networkName,
      );

      newProvider.pollingInterval = 15000;

      await Promise.race([
        newProvider.ready,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Provider connection timeout')), 30000)
        )
      ]);

      await newProvider.getBlockNumber();

      this.providers[network] = newProvider;
      this.contracts[network] = new ethers.Contract(
        network === Network.ARBITRUM_SEPOLIA
          ? this.configService.get<string>('ARBITRUM_ERC20_ADDRESS') || ''
          : this.configService.get<string>('OPTIMISM_ERC20_ADDRESS') || '',
        MockERC20Abi,
        newProvider,
      );

      this.reconnectAttempts[network] = 0;
      this.providerHealthStatus[network] = true;

      if (!useBackup && this.usingBackupRpc[network]) {
        this.usingBackupRpc[network] = false;
        this.logger.log(`Successfully reconnected to primary RPC for ${network}`);
      }

      this.listenToEvents(network);

      // Check for missed events if we know the last processed block
      if (lastKnownBlock > 0) {
        this.checkForMissedEvents(network, lastKnownBlock);
      }

      this.logger.log(`Successfully reconnected provider for ${network}`);
    } catch (error) {
      this.logger.error(
        `Failed to reconnect provider for ${network} (attempt ${attempt + 1}): ${error.message}`,
      );

      // Schedule next attempt
      setTimeout(() => this.reconnectProvider(network, lastKnownBlock), delay);
    }
  }

  private async checkForMissedEvents(network: Network, lastKnownBlock: number) {
    try {
      const provider = this.providers[network];
      const contract = this.contracts[network];

      const currentBlock = await Promise.race([
        provider.getBlockNumber(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('getBlockNumber timeout')), 15000)
        )
      ]);

      this.logger.log(
        `Checking for missed events on ${network} from block ${lastKnownBlock} to ${currentBlock}`,
      );

      if (lastKnownBlock >= currentBlock) {
        this.logger.log(`No new blocks to check on ${network}`);
        return;
      }

      const MAX_BLOCKS_PER_QUERY = 10000;
      const startBlock = lastKnownBlock + 1;
      const endBlock = Math.min(currentBlock, startBlock + MAX_BLOCKS_PER_QUERY - 1);

      const burnFilter = contract.filters.TokensBurned();
      const mintFilter = contract.filters.TokensMinted();

      const missedBurnEvents = await Promise.race([
        contract.queryFilter(
          burnFilter,
          startBlock,
          endBlock,
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('queryFilter timeout for burn events')), 30000)
        )
      ]);

      const missedMintEvents = await Promise.race([
        contract.queryFilter(
          mintFilter,
          startBlock,
          endBlock,
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('queryFilter timeout for mint events')), 30000)
        )
      ]);

      if (endBlock < currentBlock) {
        this.logger.log(`Processed blocks ${startBlock} to ${endBlock}, scheduling check for remaining blocks`);
        setTimeout(() => this.checkForMissedEvents(network, endBlock), 1000);
      }

      this.logger.log(
        `Found ${missedBurnEvents.length} missed burn events and ${missedMintEvents.length} missed mint events`,
      );

      for (const event of missedBurnEvents) {
        const [from, amount, burnId] = event.args as [
          string,
          ethers.BigNumber,
          string,
        ];
        await this.processBurnEvent(from, amount, burnId, event, network);
      }

      for (const event of missedMintEvents) {
        const [to, amount, burnId] = event.args as [
          string,
          ethers.BigNumber,
          string,
        ];
        await this.processMintEvent(to, amount, burnId, event, network);
      }
    } catch (error) {
      this.logger.error(`Error checking for missed events: ${error.message}`);
    }
  }

  private setupBurnEventListener(
    contract: ethers.Contract,
    network: Network,
    updateLastBlock: (blockNumber: number) => void,
  ) {
    const burnFilter = contract.filters.TokensBurned();

    contract.on(
      burnFilter,
      async (
        from: string,
        amount: ethers.BigNumber,
        burnId: string,
        event: ethers.Event,
      ) => {
        this.logger.log(
          `TokensBurned event detected on ${network}: from=${from}, amount=${amount.toString()}, burnId=${burnId}`,
        );

        try {
          await this.processBurnEvent(from, amount, burnId, event, network);
          // Update the last processed block
          if (event.blockNumber) {
            updateLastBlock(event.blockNumber);
          }
        } catch (error) {
          this.logger.error(
            `Error processing TokensBurned event: ${error.message}`,
          );
        }
      },
    );
  }

  private setupMintEventListener(
    contract: ethers.Contract,
    network: Network,
    updateLastBlock: (blockNumber: number) => void,
  ) {
    const mintFilter = contract.filters.TokensMinted();

    contract.on(
      mintFilter,
      async (
        to: string,
        amount: ethers.BigNumber,
        burnId: string,
        event: ethers.Event,
      ) => {
        this.logger.log(
          `TokensMinted event detected on ${network}: to=${to}, amount=${amount.toString()}, burnId=${burnId}`,
        );

        try {
          await this.processMintEvent(to, amount, burnId, event, network);
          if (event.blockNumber) {
            updateLastBlock(event.blockNumber);
          }
        } catch (error) {
          this.logger.error(
            `Error processing TokensMinted event: ${error.message}`,
          );
        }
      },
    );
  }

  private async processBurnEvent(
    from: string,
    amount: ethers.BigNumber,
    burnId: string,
    event: ethers.Event,
    network: Network,
  ) {
    const targetNetwork =
      network === Network.ARBITRUM_SEPOLIA
        ? Network.OPTIMISM_SEPOLIA
        : Network.ARBITRUM_SEPOLIA;

    const existingTx = await this.prisma.bridgeTransaction.findFirst({
      where: {
        sourceTransactionHash: event.transactionHash,
        sourceNetwork: network,
      },
    });

    if (existingTx) {
      this.logger.log(`Burn event already processed: ${event.transactionHash}`);
      return;
    }

    await this.prisma.bridgeTransaction.create({
      data: {
        recipient: from,
        amount: amount.toString(),
        sourceNetwork: network,
        targetNetwork,
        sourceTransactionHash: event.transactionHash,
        blockHash: event.blockHash,
        burnId: burnId,
        status: TransactionStatus.PENDING,
      },
    });

    const bridgeRequest: BridgeRequest = {
      recipient: from,
      amount: amount.toString(),
      sourceNetwork: network,
      targetNetwork,
      sourceTransactionHash: event.transactionHash,
      burnId: burnId,
    };

    await this.bridgeQueue.add('processBurn', bridgeRequest, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 10000,
      },
    });

    this.logger.log(
      `Added burn event to queue: ${JSON.stringify(bridgeRequest)}`,
    );
  }

  private async processMintEvent(
    to: string,
    amount: ethers.BigNumber,
    burnId: string,
    event: ethers.Event,
    network: Network,
  ) {
    const existingTx = await this.prisma.bridgeTransaction.findFirst({
      where: {
        targetTransactionHash: event.transactionHash,
      },
    });

    if (existingTx) {
      this.logger.log(`Mint event already processed: ${event.transactionHash}`);
      return;
    }

    await this.prisma.bridgeTransaction.create({
      data: {
        recipient: to,
        amount: amount.toString(),
        sourceNetwork: network,
        targetNetwork: network,
        sourceTransactionHash: event.transactionHash,
        targetTransactionHash: event.transactionHash,
        blockHash: event.blockHash,
        burnId: burnId,
        status: TransactionStatus.COMPLETED,
      },
    });
  }
}
