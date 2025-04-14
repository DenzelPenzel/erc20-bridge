import { Network } from '../types';

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const getChainId = (network: Network): bigint => {
  switch (network) {
    case Network.ARBITRUM_SEPOLIA:
      return BigInt(421614);
    case Network.OPTIMISM_SEPOLIA:
      return BigInt(11155420);
    default:
      throw new Error(`Unsupported network: ${network}`);
  }
};
