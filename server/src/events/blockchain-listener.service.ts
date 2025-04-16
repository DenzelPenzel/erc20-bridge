import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ethers } from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { Network, TransactionStatus, BridgeRequest } from '../types';
import MockERC20Abi from '../contracts/abi/MockERC20.json';

@Injectable()
export class BlockchainListenerService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainListenerService.name);
  private readonly providers: Record<Network, ethers.providers.JsonRpcProvider>;
  private readonly contracts: Record<Network, ethers.Contract>;

  constructor(
    private configService: ConfigService,
    @InjectQueue('bridge') private bridgeQueue: Queue,
    private prisma: PrismaService,
  ) {
    this.providers = {
      [Network.ARBITRUM_SEPOLIA]: new ethers.providers.JsonRpcProvider(
        this.configService.get<string>('RPC_ARBITRUMSEPOLIA'),
      ),
      [Network.OPTIMISM_SEPOLIA]: new ethers.providers.JsonRpcProvider(
        this.configService.get<string>('RPC_OPSEPOLIA'),
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

  onModuleInit() {
    this.logger.log('Starting blockchain event listeners');

    this.listenToEvents(Network.ARBITRUM_SEPOLIA);
    this.listenToEvents(Network.OPTIMISM_SEPOLIA);
  }

  private listenToEvents(network: Network) {
    const provider = this.providers[network];
    const contract = this.contracts[network];
    let isReconnecting = false;
    let lastProcessedBlock = 0;

    provider.on('error', (error) => {
      this.logger.error(`Provider error on ${network}: ${error.message}`);
      if (!isReconnecting) {
        this.reconnectProvider(network, lastProcessedBlock);
      }
    });

    provider.on('disconnect', (code, reason) => {
      this.logger.warn(
        `Provider disconnected on ${network}: ${reason} (${code})`,
      );
      if (!isReconnecting) {
        this.reconnectProvider(network, lastProcessedBlock);
      }
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
    this.logger.log(`Attempting to reconnect provider for ${network}...`);

    try {
      const newProvider = new ethers.providers.JsonRpcProvider(
        network === Network.ARBITRUM_SEPOLIA
          ? this.configService.get<string>('RPC_ARBITRUMSEPOLIA')
          : this.configService.get<string>('RPC_OPSEPOLIA'),
      );

      await newProvider.ready;

      this.providers[network] = newProvider;
      this.contracts[network] = new ethers.Contract(
        network === Network.ARBITRUM_SEPOLIA
          ? this.configService.get<string>('ARBITRUM_ERC20_ADDRESS') || ''
          : this.configService.get<string>('OPTIMISM_ERC20_ADDRESS') || '',
        MockERC20Abi,
        newProvider,
      );

      this.listenToEvents(network);

      // Check for missed events if we know the last processed block
      if (lastKnownBlock > 0) {
        this.checkForMissedEvents(network, lastKnownBlock);
      }

      this.logger.log(`Successfully reconnected provider for ${network}`);
    } catch (error) {
      this.logger.error(
        `Failed to reconnect provider for ${network}: ${error.message}`,
      );
      setTimeout(() => this.reconnectProvider(network, lastKnownBlock), 10000);
    }
  }

  private async checkForMissedEvents(network: Network, lastKnownBlock: number) {
    try {
      const provider = this.providers[network];
      const contract = this.contracts[network];
      const currentBlock = await provider.getBlockNumber();

      this.logger.log(
        `Checking for missed events on ${network} from block ${lastKnownBlock} to ${currentBlock}`,
      );

      if (lastKnownBlock >= currentBlock) {
        this.logger.log(`No new blocks to check on ${network}`);
        return;
      }

      const burnFilter = contract.filters.TokensBurned();
      const mintFilter = contract.filters.TokensMinted();

      const missedBurnEvents = await contract.queryFilter(
        burnFilter,
        lastKnownBlock + 1,
        currentBlock,
      );

      const missedMintEvents = await contract.queryFilter(
        mintFilter,
        lastKnownBlock + 1,
        currentBlock,
      );

      this.logger.log(
        `Found ${missedBurnEvents.length} missed burn events and ${missedMintEvents.length} missed mint events`,
      );

      // Process missed events
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
