import React, { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useWeb3 } from '../context/Web3Context';
import { initiateBridge } from '../api/bridge';

const BridgeForm: React.FC = () => {
  const [amount, setAmount] = useState<string>('');
  const [sourceChain, setSourceChain] = useState<string>('arbitrumSepolia');
  const [destinationChain, setDestinationChain] = useState<string>('optimismSepolia');
  const [balance, setBalance] = useState<string>('0');
  const [isBurning, setIsBurning] = useState<boolean>(false);
  
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

  const bridgeMutation = useMutation({
    mutationFn: async () => {
      return initiateBridge(
        account as string,
        amount,
        sourceChain,
        destinationChain
      );
    },
    onSuccess: (data) => {
      console.log('Bridge initiated successfully:', data);
      setAmount('');
      setIsBurning(false);
    },
    onError: (error) => {
      console.error('Bridge failed:', error);
      setIsBurning(false);
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
    
    if (!amount || !isConnected) {
      return;
    }

    if (networkName !== sourceChain) {
      try {
        await switchNetwork(sourceChain);
      } catch (error) {
        console.error('Failed to switch network:', error);
        return;
      }
    }

    console.log('Current network:', networkName);
    console.log('Initiating bridge from', sourceChain, 'to', destinationChain);

    try {
      setIsBurning(true); // Keeping this state for UI consistency
      bridgeMutation.mutate();
    } catch (error) {
      console.error('Error initiating bridge:', error);
      setIsBurning(false);
    }
  };

  const handleChainSwap = () => {
    setSourceChain(destinationChain);
    setDestinationChain(sourceChain);
  };

  return (
    <div className="bg-white shadow overflow-hidden sm:rounded-lg">
      <div className="px-4 py-5 sm:px-6">
        <h3 className="text-lg leading-6 font-medium text-gray-900">Bridge ERC20 Tokens</h3>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Transfer tokens between Arbitrum Sepolia and Optimism Sepolia testnets.
        </p>
      </div>
      
      <div className="border-t border-gray-200">
        {!isConnected ? (
          <div className="px-4 py-5 sm:p-6">
            <div className="flex flex-col items-center justify-center py-8">
              <p className="mb-4 text-gray-600">Connect your wallet to use the bridge</p>
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
            
            <div className="flex items-center space-x-4">
              <div className="flex-1">
                <label htmlFor="sourceChain" className="block text-sm font-medium text-gray-700">
                  From
                </label>
                <select
                  id="sourceChain"
                  name="sourceChain"
                  value={sourceChain}
                  onChange={(e) => setSourceChain(e.target.value)}
                  className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                >
                  <option value="arbitrumSepolia">Arbitrum Sepolia</option>
                  <option value="optimismSepolia">Optimism Sepolia</option>
                </select>
                {networkName !== sourceChain && (
                  <button
                    type="button"
                    onClick={() => switchNetwork(sourceChain)}
                    className="mt-1 text-xs text-indigo-600 hover:text-indigo-800"
                  >
                    Switch to this network
                  </button>
                )}
              </div>
              
              <button
                type="button"
                onClick={handleChainSwap}
                className="mt-6 p-2 bg-gray-100 rounded-full hover:bg-gray-200"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z" />
                </svg>
              </button>
              
              <div className="flex-1">
                <label htmlFor="destinationChain" className="block text-sm font-medium text-gray-700">
                  To
                </label>
                <select
                  id="destinationChain"
                  name="destinationChain"
                  value={destinationChain}
                  onChange={(e) => setDestinationChain(e.target.value)}
                  className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                >
                  <option value="arbitrumSepolia">Arbitrum Sepolia</option>
                  <option value="optimismSepolia">Optimism Sepolia</option>
                </select>
              </div>
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
                  min="0"
                  step="0.01"
                  required
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 sm:text-sm">TOKEN</span>
                </div>
              </div>
            </div>
            
            <div>
              <button
                type="submit"
                disabled={isBurning || bridgeMutation.isPending}
                className={`w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white ${
                  isBurning || bridgeMutation.isPending ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700'
                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
              >
                {isBurning ? 'Initiating Bridge...' : bridgeMutation.isPending ? 'Processing Bridge...' : 'Bridge Tokens'}
              </button>
            </div>
            
            {bridgeMutation.isError && (
              <div className="rounded-md bg-red-50 p-4">
                <div className="flex">
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">Error</h3>
                    <div className="mt-2 text-sm text-red-700">
                      <p>There was an error initiating the bridge. Please try again.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {bridgeMutation.isSuccess && (
              <div className="rounded-md bg-green-50 p-4">
                <div className="flex">
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-green-800">Success</h3>
                    <div className="mt-2 text-sm text-green-700">
                      <p>Bridge initiated successfully! Check the transactions tab for status.</p>
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

export default BridgeForm;
