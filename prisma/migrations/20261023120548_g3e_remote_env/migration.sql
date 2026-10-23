-- CreateEnum
CREATE TYPE "RemoteEnv" AS ENUM ('TEST', 'LIVE');

-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN     "remoteEnv" "RemoteEnv";

-- AlterTable
ALTER TABLE "PaymentProvider" ADD COLUMN     "remoteEnv" "RemoteEnv" NOT NULL DEFAULT 'LIVE',
ADD COLUMN     "testCredentialsRef" TEXT,
ADD COLUMN     "testWebhookSecretRef" TEXT;
