-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('INTERNAL', 'EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "CommTopic" AS ENUM ('TRANSACTIONAL', 'ACADEMIC', 'FINANCE', 'ANNOUNCEMENT', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "MessageAudience" AS ENUM ('ALL_PARENTS', 'CLASS_PARENTS', 'GUARDIAN', 'STUDENTS', 'TEACHERS', 'STAFF');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENT', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "PrefAction" AS ENUM ('OPT_IN', 'OPT_OUT');

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SchoolMessage" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "MessageAudience" NOT NULL,
    "classroomId" TEXT,
    "guardianId" TEXT,
    "channels" "MessageChannel"[] DEFAULT ARRAY['INTERNAL']::"MessageChannel"[],
    "topic" "CommTopic" NOT NULL DEFAULT 'OPTIONAL',
    "status" "MessageStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageDelivery" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "messageId" TEXT,
    "userId" TEXT,
    "guardianId" TEXT,
    "channel" "MessageChannel" NOT NULL,
    "address" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "providerRef" TEXT,
    "costUnits" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "dedupKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCommPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "topic" "CommTopic" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCommPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommConsentEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "channel" "MessageChannel" NOT NULL,
    "topic" "CommTopic" NOT NULL,
    "action" "PrefAction" NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardianCommConsent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "smsOptIn" BOOLEAN NOT NULL DEFAULT false,
    "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false,
    "optOutAll" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardianCommConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "schoolId" TEXT,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "dedupKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskRun" (
    "id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "scopeId" TEXT,
    "status" TEXT NOT NULL,
    "detail" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TaskRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolMessage_schoolId_status_idx" ON "SchoolMessage"("schoolId", "status");

-- CreateIndex
CREATE INDEX "SchoolMessage_schoolId_scheduledAt_idx" ON "SchoolMessage"("schoolId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageDelivery_dedupKey_key" ON "MessageDelivery"("dedupKey");

-- CreateIndex
CREATE INDEX "MessageDelivery_schoolId_status_idx" ON "MessageDelivery"("schoolId", "status");

-- CreateIndex
CREATE INDEX "MessageDelivery_messageId_idx" ON "MessageDelivery"("messageId");

-- CreateIndex
CREATE INDEX "MessageDelivery_userId_idx" ON "MessageDelivery"("userId");

-- CreateIndex
CREATE INDEX "UserCommPreference_userId_idx" ON "UserCommPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCommPreference_userId_channel_topic_key" ON "UserCommPreference"("userId", "channel", "topic");

-- CreateIndex
CREATE INDEX "CommConsentEvent_userId_idx" ON "CommConsentEvent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GuardianCommConsent_guardianId_key" ON "GuardianCommConsent"("guardianId");

-- CreateIndex
CREATE INDEX "GuardianCommConsent_schoolId_idx" ON "GuardianCommConsent"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_code_key" ON "MessageTemplate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupKey_key" ON "Job"("dedupKey");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE INDEX "Job_schoolId_idx" ON "Job"("schoolId");

-- CreateIndex
CREATE INDEX "TaskRun_task_startedAt_idx" ON "TaskRun"("task", "startedAt");

-- AddForeignKey
ALTER TABLE "SchoolMessage" ADD CONSTRAINT "SchoolMessage_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDelivery" ADD CONSTRAINT "MessageDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SchoolMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
