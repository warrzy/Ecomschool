-- CreateEnum
CREATE TYPE "MobileMoneyOperator" AS ENUM ('ORANGE_MONEY', 'MOOV_MONEY');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'MOBILE_MONEY_MANUAL';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "merchantAccount" TEXT,
ADD COLUMN     "mobileMoneyOperator" "MobileMoneyOperator",
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- Anti-doublon : une même référence opérateur ne peut être enregistrée
-- qu'une fois par établissement et opérateur (PENDING ou VALIDATED).
-- Les entrées CANCELLED n'occupent pas la référence : la ressaisie
-- après rejet reste possible.
CREATE UNIQUE INDEX "Payment_manual_momo_ref_key" ON "Payment"("schoolId", "mobileMoneyOperator", "reference")
WHERE "mobileMoneyOperator" IS NOT NULL AND "status" <> 'CANCELLED';
