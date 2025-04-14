-- CreateEnum
CREATE TYPE "Network" AS ENUM ('arbitrumSepolia', 'optimismSepolia');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'recovery_in_progress');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('burn', 'mint');

-- CreateTable
CREATE TABLE "bridge_transactions" (
    "id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "sourceNetwork" "Network" NOT NULL,
    "targetNetwork" "Network" NOT NULL,
    "sourceTransactionHash" TEXT,
    "blockHash" TEXT,
    "targetTransactionHash" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'pending',
    "gelatoTaskId" TEXT,
    "recoveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bridge_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bridge_transactions_recipient_idx" ON "bridge_transactions"("recipient");

-- CreateIndex
CREATE INDEX "bridge_transactions_sourceTransactionHash_idx" ON "bridge_transactions"("sourceTransactionHash");

-- CreateIndex
CREATE INDEX "bridge_transactions_status_idx" ON "bridge_transactions"("status");

-- CreateIndex
CREATE INDEX "bridge_transactions_gelatoTaskId_idx" ON "bridge_transactions"("gelatoTaskId");

-- CreateIndex
CREATE INDEX "bridge_transactions_createdAt_idx" ON "bridge_transactions"("createdAt");

-- CreateIndex
CREATE INDEX "bridge_transactions_recipient_status_idx" ON "bridge_transactions"("recipient", "status");

-- CreateIndex
CREATE INDEX "bridge_transactions_sourceNetwork_targetNetwork_status_idx" ON "bridge_transactions"("sourceNetwork", "targetNetwork", "status");
