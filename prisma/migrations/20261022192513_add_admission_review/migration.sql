-- CreateEnum
CREATE TYPE "AdmissionInterviewType" AS ENUM ('INTERVIEW', 'WRITTEN_TEST', 'EVALUATION', 'OTHER');

-- CreateEnum
CREATE TYPE "AdmissionInterviewStatus" AS ENUM ('PLANNED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "AdmissionApplication" ADD COLUMN     "assignedToId" TEXT,
ADD COLUMN     "decisionConditions" TEXT,
ADD COLUMN     "waitlistRank" INTEGER;

-- AlterTable
ALTER TABLE "AdmissionCampaign" ADD COLUMN     "capacityEnforced" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AdmissionInterview" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" "AdmissionInterviewType" NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "evaluatorId" TEXT,
    "evaluatorName" TEXT,
    "instructions" TEXT,
    "result" TEXT,
    "internalNote" TEXT,
    "status" "AdmissionInterviewStatus" NOT NULL DEFAULT 'PLANNED',
    "previousScheduledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionInterview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdmissionInterview_applicationId_idx" ON "AdmissionInterview"("applicationId");

-- CreateIndex
CREATE INDEX "AdmissionInterview_schoolId_status_scheduledAt_idx" ON "AdmissionInterview"("schoolId", "status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionInterview" ADD CONSTRAINT "AdmissionInterview_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionInterview" ADD CONSTRAINT "AdmissionInterview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
