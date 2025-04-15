import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { Network, TransactionStatus } from '../types';
import MockERC20Abi from '../contracts/abi/MockERC20.json';
import {
  createWalletClient,
  http,
  createPublicClient,
  parseAbi,
  encodeFunctionData,
  parseEther,
  type PublicClient,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia, optimismSepolia } from 'viem/chains';
import {
  GelatoRelay,
  CallWithERC2771Request,
} from '@gelatonetwork/relay-sdk-viem';

@Injectable()
export class MintService {
  private readonly logger = new Logger(MintService.name);
  private readonly providers: Record<Network, ethers.providers.JsonRpcProvider>;
  private readonly contracts: Record<Network, ethers.Contract>;
  private readonly publicClients: Record<Network, PublicClient>;
  private readonly chains: Record<Network, Chain>;
  private readonly gelatoRelay: GelatoRelay;

  constructor(private configService: ConfigService) {
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

    this.chains = {
      [Network.ARBITRUM_SEPOLIA]: arbitrumSepolia,
      [Network.OPTIMISM_SEPOLIA]: optimismSepolia,
    };

    this.publicClients = {
      [Network.ARBITRUM_SEPOLIA]: createPublicClient({
        chain: arbitrumSepolia,
        transport: http(
          this.configService.get<string>('ARBITRUM_SEPOLIA_RPC_URL') ||
            'https://sepolia-rollup.arbitrum.io/rpc',
        ),
      }) as PublicClient,
      [Network.OPTIMISM_SEPOLIA]: createPublicClient({
        chain: optimismSepolia,
        transport: http(
          this.configService.get<string>('OPTIMISM_SEPOLIA_RPC_URL') ||
            'https://sepolia.optimism.io',
        ),
      }) as PublicClient,
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
  }

  private createERC2771Request(
    network: Network,
    target: string,
    data: string,
    user: string,
  ): CallWithERC2771Request {
    const chainId = BigInt(this.chains[network].id);
    return {
      chainId,
      target: target as `0x${string}`,
      data: data as `0x${string}`,
      user: user as `0x${string}`,
    };
  }

  async mintTokens(recipient: string, amount: string, network: Network) {
    this.logger.log(`Minting ${amount} tokens to ${recipient} on ${network}`);

    if (!ethers.utils.isAddress(recipient)) {
      throw new BadRequestException('Invalid recipient address');
    }

    let amountInWei: bigint;
    try {
      amountInWei = parseEther(amount);
      if (amountInWei <= 0n) {
        throw new BadRequestException('Amount must be greater than 0');
      }
    } catch (error: any) {
      throw new BadRequestException(`Invalid amount: ${error.message}`);
    }

    const apiKey = this.configService.get<string>('GELATO_API_KEY');
    if (!apiKey) {
      throw new BadRequestException('Gelato API key is not configured');
    }

    const contract = this.contracts[network];
    if (!contract || !contract.address) {
      throw new BadRequestException(
        `Contract not found for network ${network}`,
      );
    }

    try {
      const contractAddress = contract.address as `0x${string}`;
      const uniqueBurnId = `0x${Buffer.from(
        ethers.utils
          .solidityKeccak256(
            ['address', 'uint256', 'uint256', 'string'],
            [
              recipient,
              amountInWei.toString(),
              Date.now(),
              Math.random().toString(),
            ],
          )
          .slice(2),
        'hex',
      ).toString('hex')}`;

      this.logger.log(`Using burnId: ${uniqueBurnId} for minting`);

      const data = encodeFunctionData({
        abi: parseAbi([
          'function mint(address to, uint256 amount, bytes32 burnId) external',
        ]),
        functionName: 'mint',
        args: [
          recipient as `0x${string}`,
          amountInWei,
          uniqueBurnId as `0x${string}`,
        ],
      });

      const privateKey = this.configService.get<string>('PRIVATE_KEY');
      if (!privateKey) {
        throw new BadRequestException('Private key not configured');
      }

      const account = privateKeyToAccount(privateKey as `0x${string}`);

      const request = this.createERC2771Request(
        network,
        contractAddress,
        data,
        account.address,
      );

      this.logger.log(`Contract address: ${contractAddress}`);

      const walletClient = createWalletClient({
        account,
        chain: this.chains[network],
        transport: http(
          network === Network.ARBITRUM_SEPOLIA
            ? this.configService.get<string>('ARBITRUM_SEPOLIA_RPC_URL') ||
                'https://sepolia-rollup.arbitrum.io/rpc'
            : this.configService.get<string>('OPTIMISM_SEPOLIA_RPC_URL') ||
                'https://sepolia.optimism.io',
        ),
      });

      const { taskId } = await this.gelatoRelay.sponsoredCallERC2771(
        request,
        walletClient,
        apiKey,
      );

      return {
        taskId,
        status: TransactionStatus.PENDING,
        message: 'Mint transaction submitted successfully via ERC2771',
      };
    } catch (error: any) {
      this.logger.error(`Error minting tokens: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to mint tokens: ${error.message}`);
    }
  }
}
