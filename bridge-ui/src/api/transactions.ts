import { Transaction, PaginationParams, TransactionsResponse, MintTokensRequest } from '../types/transaction';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

interface FetchTransactionsParams {
  address?: string;
  status?: string[];
  limit?: number;
  offset?: number;
}

export const fetchTransactions = async (params: FetchTransactionsParams = {}): Promise<TransactionsResponse> => {
  try {
    const { address, status, limit, offset } = params;
    let url = `${API_BASE_URL}/bridge/transactions`;
    
    const queryParams = new URLSearchParams();
    
    if (address) {
      queryParams.append('recipient', address);
    }
    
    if (status && status.length > 0) {
      status.forEach(s => queryParams.append('status', s));
    }
    
    if (limit) {
      queryParams.append('limit', limit.toString());
    }
    
    if (offset !== undefined) {
      queryParams.append('offset', offset.toString());
    }
    
    const queryString = queryParams.toString();
    if (queryString) {
      url = `${url}?${queryString}`;
    }
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Error: ${response.status}`);
    }
    
    const data = await response.json();
    return data || { transactions: [], pagination: { total: 0, limit: 10, offset: 0, hasMore: false } };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to fetch transactions');
  }
};
