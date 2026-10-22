-- AlterTable
ALTER TABLE "PaymentProvider" ADD COLUMN     "maxAmount" INTEGER,
ADD COLUMN     "minAmount" INTEGER NOT NULL DEFAULT 100;
