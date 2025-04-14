import React, { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useWeb3 } from '../context/Web3Context';
import { mintTokens } from '../api/mint';
import { MintTokensRequest } from '../types/transaction';

const MintForm: React.FC = () => {
  const [amount, setAmount] = useState<string>('');
  const [network, setNetwork] = useState<string>('arbitrumSepolia');
  const [isMinting, setIsMinting] = useState<boolean>(false);
  const [balance, setBalance] = useState<string>('0');
  
  const { 
    account, 
    isConnected, 
    isConnecting, 
    networkName,
    error: web3Error, 
    connectWallet, 
    switchNetwork,
    getBalance
  } = useWeb3();

  const mintMutation = useMutation({
    mutationFn: async (mintRequest: MintTokensRequest) => {
      return await mintTokens(mintRequest);
    },
    onSuccess: (data) => {
      setAmount('');
      setIsMinting(false);
    },
    onError: (error) => {
      setIsMinting(false);
    }
  });

  useEffect(() => {
    if (isConnected && account) {
      fetchBalance();
    }
  }, [isConnected, account, networkName]);

  const fetchBalance = async () => {
    if (isConnected && account) {
      try {
        const userBalance = await getBalance();
        setBalance(userBalance);
      } catch (error) {
        console.error('Error fetching balance:', error);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!amount || !isConnected || !account) {
      return;
    }
    
    const amountValue = parseFloat(amount);
    if (amountValue < 0.01 || amountValue > 1) {
      alert('Amount must be between 0.01 and 1 tokens');
      return;
    }

    if (networkName !== network) {
      try {
        await switchNetwork(network);
      } catch (error) {
        console.error('Failed to switch network:', error);
        return;
      }
    }

    try {
      setIsMinting(true);
      const mintRequest: MintTokensRequest = {
        recipient: account,
        amount,
        network
      };
      
      mintMutation.mutate(mintRequest);
    } catch (error) {
      console.error('Error minting tokens:', error);
      setIsMinting(false);
    }
  };

  return (
    <div className="bg-white shadow overflow-hidden sm:rounded-lg mt-6">
      <div className="px-4 py-5 sm:px-6">
        <h3 className="text-lg leading-6 font-medium text-gray-900">Mint ERC20 Tokens</h3>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Mint tokens to your wallet on Arbitrum Sepolia or Optimism Sepolia testnets.
        </p>
      </div>
      
      <div className="border-t border-gray-200">
        {!isConnected ? (
          <div className="px-4 py-5 sm:p-6">
            <div className="flex flex-col items-center justify-center py-8">
              <p className="mb-4 text-gray-600">Connect your wallet to mint tokens</p>
              <button
                type="button"
                onClick={connectWallet}
                disabled={isConnecting}
                className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${isConnecting ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700'} focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
              >
                {isConnecting ? 'Connecting...' : 'Connect Wallet'}
              </button>
              {web3Error && (
                <p className="mt-2 text-sm text-red-600">{web3Error}</p>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-4 py-5 sm:p-6">
            <div className="grid grid-cols-1 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Connected Account
                </label>
                <div className="mt-1 flex items-center">
                  <span className="px-3 py-2 block w-full shadow-sm text-gray-500 sm:text-sm border border-gray-300 rounded-md bg-gray-50">
                    {account}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  Balance: {balance} TOKEN
                </p>
              </div>
            
              <div>
                <label htmlFor="network" className="block text-sm font-medium text-gray-700">
                  Network
                </label>
                <select
                  id="network"
                  name="network"
                  value={network}
                  onChange={(e) => setNetwork(e.target.value)}
                  className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                >
                  <option value="arbitrumSepolia">Arbitrum Sepolia</option>
                  <option value="optimismSepolia">Optimism Sepolia</option>
                </select>
                {networkName !== network && (
                  <button
                    type="button"
                    onClick={() => switchNetwork(network)}
                    className="mt-1 text-xs text-indigo-600 hover:text-indigo-800"
                  >
                    Switch to this network
                  </button>
                )}
              </div>
              
              <div>
                <label htmlFor="amount" className="block text-sm font-medium text-gray-700">
                  Amount
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <input
                    type="number"
                    name="amount"
                    id="amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pr-12 sm:text-sm border-gray-300 rounded-md"
                    placeholder="0.0"
                    min="0.01"
                    max="1"
                    step="0.01"
                    required
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <span className="text-gray-500 sm:text-sm">TOKEN</span>
                  </div>
                </div>
                <p className="mt-1 text-xs text-gray-500">Min: 0.01, Max: 1 tokens</p>
              </div>
              
              <div>
                <button
                  type="submit"
                  disabled={isMinting || mintMutation.isPending}
                  className={`w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white ${
                    isMinting || mintMutation.isPending ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700'
                  } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
                >
                  {isMinting ? 'Minting Tokens...' : mintMutation.isPending ? 'Processing Mint...' : 'Mint Tokens'}
                </button>
              </div>
              
              {mintMutation.isError && (
                <div className="rounded-md bg-red-50 p-4">
                  <div className="flex">
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-red-800">Error</h3>
                      <div className="mt-2 text-sm text-red-700">
                        <p>There was an error minting tokens. Please try again.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {mintMutation.isSuccess && (
                <div className="rounded-md bg-green-50 p-4">
                  <div className="flex">
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-green-800">Success</h3>
                      <div className="mt-2 text-sm text-green-700">
                        <p>Tokens minted successfully! Check the transactions tab for status.</p>
                        {mintMutation.data?.transactionId && (
                          <p className="mt-1">Transaction ID: {mintMutation.data.transactionId}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default MintForm;
