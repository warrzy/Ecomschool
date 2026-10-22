-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentTxKind" ADD VALUE 'CONFIRM';
ALTER TYPE "PaymentTxKind" ADD VALUE 'FAIL';
ALTER TYPE "PaymentTxKind" ADD VALUE 'EXPIRE';
ALTER TYPE "PaymentTxKind" ADD VALUE 'CANCEL';
ALTER TYPE "PaymentTxKind" ADD VALUE 'POSTING';

-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN     "feeInstallmentId" TEXT,
ADD COLUMN     "providerTxId" TEXT;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_feeInstallmentId_fkey" FOREIGN KEY ("feeInstallmentId") REFERENCES "FeeInstallment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
