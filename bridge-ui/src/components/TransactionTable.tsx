import React from 'react';
import { Transaction, TransactionStatus } from '../types/transaction';

const formatDate = (timestamp: number) => {
  return new Date(timestamp).toLocaleString();
};

const getStatusBadge = (status: TransactionStatus) => {
  switch (status) {
    case TransactionStatus.PENDING:
      return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">Pending</span>;
    case TransactionStatus.PROCESSING:
      return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">Processing</span>;
    case TransactionStatus.COMPLETED:
      return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Completed</span>;
    case TransactionStatus.FAILED:
      return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">Failed</span>;
    default:
      return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">Unknown</span>;
  }
};

interface TransactionTableProps {
  transactions: Transaction[];
  emptyMessage: string;
}

const TransactionTable: React.FC<TransactionTableProps> = ({ transactions, emptyMessage }) => {
  return (
    <div className="overflow-x-auto">
      {transactions.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-gray-500">{emptyMessage}</p>
        </div>
      ) : (
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                ID
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                From
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                To
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Amount
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Date
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {transactions.map((transaction) => (
              <tr key={transaction.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {transaction.id.substring(0, 8)}...
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{transaction.sourceNetwork}</div>
                  <div className="text-sm text-gray-500">{transaction.sourceTransactionHash ? `${transaction.sourceTransactionHash.substring(0, 6)}...${transaction.sourceTransactionHash.substring(transaction.sourceTransactionHash.length - 4)}` : '...'}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{transaction.targetNetwork}</div>
                  <div className="text-sm text-gray-500">{transaction.recipient.substring(0, 6)}...{transaction.recipient.substring(transaction.recipient.length - 4)}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {transaction.amount}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {formatDate(new Date(transaction.createdAt).getTime())}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {getStatusBadge(transaction.status)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export { TransactionTable, formatDate, getStatusBadge };
