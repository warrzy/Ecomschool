-- AlterTable
ALTER TABLE "PaymentProvider" ADD COLUMN     "config" JSONB,
ADD COLUMN     "credentialsRotatedAt" TIMESTAMP(3),
ADD COLUMN     "liveEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "liveEnabledAt" TIMESTAMP(3),
ADD COLUMN     "liveEnabledById" TEXT,
ADD COLUMN     "refundsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "PaymentProvider" ADD CONSTRAINT "PaymentProvider_liveEnabledById_fkey" FOREIGN KEY ("liveEnabledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
