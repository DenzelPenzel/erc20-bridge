import React, { useState } from 'react';
import ActiveTransactions from './ActiveTransactions';
import HistoryTransactions from './HistoryTransactions';

const TransactionList: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');

  return (
    <div className="bg-white shadow overflow-hidden sm:rounded-lg">
      <div className="px-4 py-5 sm:px-6">
        <h3 className="text-lg leading-6 font-medium text-gray-900">Your Transactions</h3>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          View and track your bridge transactions.
        </p>
      </div>
      
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('active')}
            className={`${
              activeTab === 'active'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } w-1/2 py-4 px-1 text-center border-b-2 font-medium text-sm`}
          >
            Active Transactions
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`${
              activeTab === 'history'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } w-1/2 py-4 px-1 text-center border-b-2 font-medium text-sm`}
          >
            Transaction History
          </button>
        </nav>
      </div>
      
      <div className="px-4 py-5 sm:p-6">
        {activeTab === 'active' ? (
          <ActiveTransactions />
        ) : (
          <HistoryTransactions />
        )}
      </div>
    </div>
  );
};

export default TransactionList;
