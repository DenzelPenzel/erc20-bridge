export enum TransactionStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface Transaction {
  id: string;
  recipient: string;
  amount: string;
  sourceNetwork: string;
  targetNetwork: string;
  sourceTransactionHash?: string;
  targetTransactionHash?: string;
  blockHash?: string;
  status: TransactionStatus;
  createdAt: string;
  updatedAt: string;
  gelatoTaskId?: string;
}

export interface PaginationInfo {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface TransactionsResponse {
  transactions: Transaction[];
  pagination: PaginationInfo;
}

export interface MintTokensRequest {
  recipient: string;
  amount: string;
  network: string;
}
