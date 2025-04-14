import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import Web3 from 'web3';
import MockERC20ABI from '../contracts/abi/MockERC20.json';

export const NETWORKS = {
  arbitrumSepolia: {
    chainId: '0x66eee',  // 421614 in hex
    chainName: 'Arbitrum Sepolia',
    rpcUrl: 'https://arbitrum-sepolia.drpc.org',
    contractAddress: process.env.REACT_APP_ARBITRUM_ERC20_ADDRESS,
  },
  optimismSepolia: {
    chainId: '0xaa37dc', // 11155420 in hex
    chainName: 'Optimism Sepolia',
    rpcUrl: 'https://sepolia.optimism.io',
    contractAddress: process.env.REACT_APP_OPTIMISM_ERC20_ADDRESS, 
  }
};

interface Web3ContextType {
  web3: Web3 | null;
  account: string | null;
  chainId: number | null;
  networkName: string;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  switchNetwork: (networkName: string) => Promise<void>;
  burnTokens: (amount: string) => Promise<any>;
  getBalance: () => Promise<string>;
}

const Web3Context = createContext<Web3ContextType | undefined>(undefined);

export const Web3Provider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [web3, setWeb3] = useState<Web3 | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [networkName, setNetworkName] = useState<string>('arbitrumSepolia');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (window.ethereum) {
      const web3Instance = new Web3(window.ethereum);
      setWeb3(web3Instance);

      web3Instance.eth.getAccounts().then(accounts => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          setIsConnected(true);
          
          web3Instance.eth.getChainId().then(id => {
            setChainId(id);
            updateNetworkName(id);
          });
        }
      });

      window.ethereum.on('accountsChanged', (accounts: string[]) => {
        if (accounts.length === 0) {
          setAccount(null);
          setIsConnected(false);
        } else {
          setAccount(accounts[0]);
          setIsConnected(true);
        }
      });

      window.ethereum.on('chainChanged', (chainIdHex: string) => {
        const newChainId = parseInt(chainIdHex, 16);
        setChainId(newChainId);
        updateNetworkName(newChainId);
      });
    } else {
      setError('Please install MetaMask to use this application');
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeAllListeners('accountsChanged');
        window.ethereum.removeAllListeners('chainChanged');
      }
    };
  }, []);

  const updateNetworkName = (id: number) => {
    const hexChainId = '0x' + id.toString(16).toLowerCase();    
    const arbitrumChainId = NETWORKS.arbitrumSepolia.chainId.toLowerCase();
    const optimismChainId = NETWORKS.optimismSepolia.chainId.toLowerCase();
    
    if (hexChainId === arbitrumChainId) {
      setNetworkName('arbitrumSepolia');
    } else if (hexChainId === optimismChainId) {
      setNetworkName('optimismSepolia');
    } else {
      setNetworkName('arbitrumSepolia');
    }
  };

  const connectWallet = async () => {
    if (!web3) {
      setError('Web3 not initialized');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const accounts = await window.ethereum.request({ 
        method: 'eth_requestAccounts' 
      });
      
      if (accounts.length > 0) {
        setAccount(accounts[0]);
        setIsConnected(true);
        
        const id = await web3.eth.getChainId();
        setChainId(id);
        updateNetworkName(id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setAccount(null);
    setIsConnected(false);
  };

  const switchNetwork = async (network: string) => {
    if (!web3 || !window.ethereum) {
      setError('Web3 not initialized');
      return;
    }

    const networkConfig = NETWORKS[network as keyof typeof NETWORKS];
    if (!networkConfig) {
      setError(`Network ${network} not supported`);
      return;
    }

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: networkConfig.chainId }],
      });
      
      setNetworkName(network);
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: networkConfig.chainId,
                chainName: networkConfig.chainName,
                rpcUrls: [networkConfig.rpcUrl],
              },
            ],
          });
          setNetworkName(network);
        } catch (addError: any) {
          setError(addError.message || 'Failed to add network');
        }
      } else {
        setError(switchError.message || 'Failed to switch network');
      }
    }
  };

  const getContract = () => {
    if (!web3 || !account) {
      throw new Error('Web3 not initialized or wallet not connected');
    }

    const networkConfig = NETWORKS[networkName as keyof typeof NETWORKS];
    if (!networkConfig) {
      throw new Error(`Network ${networkName} not supported`);
    }

    console.log(`Using contract address: ${JSON.stringify(networkConfig)}`);

    return new web3.eth.Contract(
      MockERC20ABI as any,
      networkConfig.contractAddress
    );
  };

  const burnTokens = async (amount: string) => {
    if (!web3 || !account) {
      throw new Error('Wallet not connected');
    }

    const currentChainId = await web3.eth.getChainId();
    const currentHexChainId = '0x' + currentChainId.toString(16).toLowerCase();
    const arbitrumChainId = NETWORKS.arbitrumSepolia.chainId.toLowerCase();
    const optimismChainId = NETWORKS.optimismSepolia.chainId.toLowerCase();
    
    if (currentHexChainId !== arbitrumChainId && currentHexChainId !== optimismChainId) {
      throw new Error('Please connect to either Arbitrum Sepolia or Optimism Sepolia network');
    }
    
    console.log(`Executing burn transaction on ${currentHexChainId === arbitrumChainId ? 'Arbitrum Sepolia' : 'Optimism Sepolia'}`);

    try {
      const contract = getContract();
      const amountInWei = web3.utils.toWei(amount, 'ether');
      
      return await contract.methods.burn(account, amountInWei).send({ from: account });
    } catch (error: any) {
      throw new Error(error.message || 'Failed to burn tokens');
    }
  };

  const getBalance = async () => {
    if (!web3 || !account) {
      return '0';
    }

    try {
      const networkConfig = NETWORKS[networkName as keyof typeof NETWORKS];
      if (!networkConfig) {
        console.error(`Network ${networkName} not supported`);
        return '0';
      }

      if (!networkConfig.contractAddress || !web3.utils.isAddress(networkConfig.contractAddress)) {
        console.error(`Invalid contract address: ${networkConfig.contractAddress}`);
        return '0';
      }

      if (!web3 || !web3.utils) {
        return '0';
      }
      
      const functionSignature = web3.utils.sha3('balanceOf(address)')?.substring(0, 10) || '';
      if (!functionSignature) {
        return '0';
      }
      
      const encodedAccount = web3.utils.padLeft(web3.utils.toHex(account || '').substring(2), 64);
      const data = functionSignature + encodedAccount;
            
      try {
        const result = await web3.eth.call({
          to: networkConfig.contractAddress,
          data: data
        });
                
        if (result && result !== '0x') {
          const balanceHex = result.startsWith('0x') ? result : '0x' + result;
          const balanceWei = web3.utils.toBN(balanceHex);
          
          return web3.utils.fromWei(balanceWei, 'ether');
        } else {
          return '0';
        }
      } catch (callError) {
        try {
          const nativeBalance = await web3.eth.getBalance(account);
          return web3.utils.fromWei(nativeBalance, 'ether');
        } catch (nativeError) {
          return '0';
        }
      }
    } catch (error) {
      console.error('Error in getBalance:', error);
      return '0';
    }
  };

  const value = {
    web3,
    account,
    chainId,
    networkName,
    isConnected,
    isConnecting,
    error,
    connectWallet,
    disconnectWallet,
    switchNetwork,
    burnTokens,
    getBalance,
  };

  return <Web3Context.Provider value={value}>{children}</Web3Context.Provider>;
};

export const useWeb3 = (): Web3ContextType => {
  const context = useContext(Web3Context);
  if (context === undefined) {
    throw new Error('useWeb3 must be used within a Web3Provider');
  }
  return context;
};

declare global {
  interface Window {
    ethereum: any;
  }
}
