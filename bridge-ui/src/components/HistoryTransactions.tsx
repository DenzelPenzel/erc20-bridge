import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchTransactions } from '../api/transactions';
import { TransactionStatus } from '../types/transaction';
import Pagination from './Pagination';
import { useWeb3 } from '../context/Web3Context';
import { TransactionTable } from './TransactionTable';

const ITEMS_PER_PAGE = 10;

const HistoryTransactions: React.FC = () => {
  const [page, setPage] = useState(1);
  const { account, isConnected } = useWeb3();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['history-transactions', account, page],
    queryFn: () => fetchTransactions({
      address: account || undefined,
      status: [TransactionStatus.COMPLETED, TransactionStatus.FAILED],
      limit: ITEMS_PER_PAGE,
      offset: (page - 1) * ITEMS_PER_PAGE
    }),
    enabled: isConnected
  });

  const transactions = data?.transactions || [];
  const paginationInfo = data?.pagination || { total: 0, limit: ITEMS_PER_PAGE, offset: 0, hasMore: false };
  
  const totalPages = Math.max(1, Math.ceil(paginationInfo.total / paginationInfo.limit));

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <div className="flex">
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800">Error</h3>
            <div className="mt-2 text-sm text-red-700">
              <p>There was an error loading transactions. Please try again later.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TransactionTable 
        transactions={transactions} 
        emptyMessage="No transaction history found."
      />
      {transactions.length > 0 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  );
};

export default HistoryTransactions;
