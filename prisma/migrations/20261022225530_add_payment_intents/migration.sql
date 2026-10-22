-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED', 'PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'CANCELLED', 'CONFIRMED_PENDING_POSTING');

-- CreateEnum
CREATE TYPE "PaymentIntentChannel" AS ENUM ('PARENT_PORTAL', 'CASHIER_DESK', 'ADMIN_TEST');

-- CreateEnum
CREATE TYPE "PaymentProviderMode" AS ENUM ('SANDBOX', 'LIVE');

-- CreateEnum
CREATE TYPE "PaymentTxKind" AS ENUM ('INITIATE', 'STATUS_CHECK', 'WEBHOOK', 'REFUND');

-- CreateTable
CREATE TABLE "PaymentProvider" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mode" "PaymentProviderMode" NOT NULL DEFAULT 'SANDBOX',
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "credentialsRef" TEXT,
    "webhookSecretRef" TEXT,
    "merchantRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "payerPhone" TEXT,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
    "channel" "PaymentIntentChannel" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerRef" TEXT,
    "paymentId" TEXT,
    "allocations" JSONB,
    "sandboxScript" JSONB,
    "failureReason" TEXT,
    "initiatedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "kind" "PaymentTxKind" NOT NULL,
    "providerTxId" TEXT,
    "rawStatus" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentProvider_schoolId_idx" ON "PaymentProvider"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProvider_schoolId_code_key" ON "PaymentProvider"("schoolId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_paymentId_key" ON "PaymentIntent"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentIntent_schoolId_status_idx" ON "PaymentIntent"("schoolId", "status");

-- CreateIndex
CREATE INDEX "PaymentIntent_studentId_idx" ON "PaymentIntent"("studentId");

-- CreateIndex
CREATE INDEX "PaymentIntent_academicYearId_idx" ON "PaymentIntent"("academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_schoolId_idempotencyKey_key" ON "PaymentIntent"("schoolId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_schoolId_providerId_providerRef_key" ON "PaymentIntent"("schoolId", "providerId", "providerRef");

-- CreateIndex
CREATE INDEX "PaymentTransaction_intentId_idx" ON "PaymentTransaction"("intentId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_schoolId_idx" ON "PaymentTransaction"("schoolId");

-- AddForeignKey
ALTER TABLE "PaymentProvider" ADD CONSTRAINT "PaymentProvider_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "PaymentProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
