export enum Network {
  ARBITRUM_SEPOLIA = 'arbitrumSepolia',
  OPTIMISM_SEPOLIA = 'optimismSepolia',
}

export enum TransactionStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RECOVERY_IN_PROGRESS = 'recovery_in_progress',
}

export enum EventType {
  BURN = 'TokensBurned',
  MINT = 'TokensMinted',
}

export interface BridgeRequest {
  recipient: string;
  amount: string;
  sourceNetwork: Network;
  targetNetwork: Network;
  sourceTransactionHash: string;
}

export enum TaskState {
  Pending = 'Pending',
  CheckPending = 'CheckPending',
  ExecPending = 'ExecPending',
  WaitingForConfirmation = 'WaitingForConfirmation',
  ExecSuccess = 'ExecSuccess',
  ExecReverted = 'ExecReverted',
  Blacklisted = 'Blacklisted',
  Cancelled = 'Cancelled',
  NotFound = 'NotFound',
}