-- CreateEnum
CREATE TYPE "FeeBearer" AS ENUM ('SCHOOL', 'PAYER');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('PENDING', 'MATCHED', 'DISCREPANCY', 'TO_VERIFY', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DECLARED', 'MATCHED', 'PARTIAL', 'DISCREPANCY', 'MISSING');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'EXECUTED', 'CONFIRMED', 'REJECTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DiscrepancyType" AS ENUM ('CONFIRMED_NO_PAYMENT', 'PAYMENT_NO_CONFIRM', 'AMOUNT_MISMATCH', 'FEE_MISMATCH', 'SETTLEMENT_MISSING', 'SETTLEMENT_PARTIAL', 'SETTLEMENT_MISMATCH', 'DUPLICATE_REFERENCE', 'LATE_CONFIRMATION', 'OVERPAYMENT_BLOCKED', 'REFUND_UNCONFIRMED', 'OTHER');

-- CreateEnum
CREATE TYPE "DiscrepancyStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'IGNORED');

-- AlterTable
ALTER TABLE "PaymentProvider" ADD COLUMN     "feeBearer" "FeeBearer" NOT NULL DEFAULT 'SCHOOL',
ADD COLUMN     "feeFixed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "feePercent" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PaymentReconciliation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "paymentId" TEXT,
    "academicYearId" TEXT,
    "grossAmount" INTEGER NOT NULL,
    "confirmedAmount" INTEGER,
    "feeAmount" INTEGER NOT NULL,
    "feeBearer" "FeeBearer" NOT NULL DEFAULT 'SCHOOL',
    "netExpected" INTEGER NOT NULL,
    "settlementId" TEXT,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "checkedById" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentSettlement" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossTotal" INTEGER NOT NULL,
    "feeTotal" INTEGER NOT NULL,
    "netExpected" INTEGER NOT NULL,
    "netDeclared" INTEGER,
    "receivedAt" TIMESTAMP(3),
    "status" "SettlementStatus" NOT NULL DEFAULT 'DECLARED',
    "declared" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "declaredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "paymentId" TEXT,
    "intentId" TEXT,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "idempotencyKey" TEXT NOT NULL,
    "providerRef" TEXT,
    "failureReason" TEXT,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentDiscrepancy" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "type" "DiscrepancyType" NOT NULL,
    "status" "DiscrepancyStatus" NOT NULL DEFAULT 'OPEN',
    "intentId" TEXT,
    "paymentId" TEXT,
    "settlementId" TEXT,
    "refundId" TEXT,
    "expectedAmount" INTEGER,
    "actualAmount" INTEGER,
    "description" TEXT NOT NULL,
    "history" JSONB,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentDiscrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReconciliation_intentId_key" ON "PaymentReconciliation"("intentId");

-- CreateIndex
CREATE INDEX "PaymentReconciliation_schoolId_status_idx" ON "PaymentReconciliation"("schoolId", "status");

-- CreateIndex
CREATE INDEX "PaymentReconciliation_settlementId_idx" ON "PaymentReconciliation"("settlementId");

-- CreateIndex
CREATE INDEX "PaymentSettlement_schoolId_status_idx" ON "PaymentSettlement"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSettlement_schoolId_providerId_reference_key" ON "PaymentSettlement"("schoolId", "providerId", "reference");

-- CreateIndex
CREATE INDEX "PaymentRefund_schoolId_status_idx" ON "PaymentRefund"("schoolId", "status");

-- CreateIndex
CREATE INDEX "PaymentRefund_paymentId_idx" ON "PaymentRefund"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_schoolId_idempotencyKey_key" ON "PaymentRefund"("schoolId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentDiscrepancy_schoolId_status_idx" ON "PaymentDiscrepancy"("schoolId", "status");

-- CreateIndex
CREATE INDEX "PaymentDiscrepancy_intentId_idx" ON "PaymentDiscrepancy"("intentId");

-- CreateIndex
CREATE INDEX "PaymentDiscrepancy_paymentId_idx" ON "PaymentDiscrepancy"("paymentId");

-- AddForeignKey
ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "PaymentProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "PaymentSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSettlement" ADD CONSTRAINT "PaymentSettlement_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSettlement" ADD CONSTRAINT "PaymentSettlement_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "PaymentProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSettlement" ADD CONSTRAINT "PaymentSettlement_declaredById_fkey" FOREIGN KEY ("declaredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDiscrepancy" ADD CONSTRAINT "PaymentDiscrepancy_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDiscrepancy" ADD CONSTRAINT "PaymentDiscrepancy_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDiscrepancy" ADD CONSTRAINT "PaymentDiscrepancy_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDiscrepancy" ADD CONSTRAINT "PaymentDiscrepancy_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "PaymentSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDiscrepancy" ADD CONSTRAINT "PaymentDiscrepancy_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "PaymentRefund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDiscrepancy" ADD CONSTRAINT "PaymentDiscrepancy_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
