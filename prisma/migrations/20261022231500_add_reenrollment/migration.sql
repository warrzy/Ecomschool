CREATE TYPE "ReenrollmentCampaignStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ReenrollmentRequestStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'ADDITIONAL_INFO_REQUIRED', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReenrollmentKind" AS ENUM ('REENROLL', 'DEPARTURE');

-- CreateEnum
CREATE TYPE "ReenrollmentProgression" AS ENUM ('PROMOTION', 'REPETITION', 'SAME_LEVEL', 'CLASS_CHANGE', 'CYCLE_CHANGE', 'RETURN');

-- CreateTable
CREATE TABLE "ReenrollmentCampaign" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sourceYearId" TEXT NOT NULL,
    "targetYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "familyMessage" TEXT,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "status" "ReenrollmentCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "targetLevelIds" JSONB,
    "progressionOverrides" JSONB,
    "requiredDocs" JSONB NOT NULL DEFAULT '[]',
    "blockOnUnpaid" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReenrollmentCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReenrollmentRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "targetYearId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sourceEnrollmentId" TEXT,
    "guardianId" TEXT,
    "submittedById" TEXT,
    "kind" "ReenrollmentKind" NOT NULL DEFAULT 'REENROLL',
    "status" "ReenrollmentRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "desiredLevelId" TEXT,
    "desiredClassroomId" TEXT,
    "progression" "ReenrollmentProgression",
    "targetClassroomId" TEXT,
    "contactUpdate" JSONB,
    "parentNote" TEXT,
    "adminNote" TEXT,
    "decisionReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "newEnrollmentId" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReenrollmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReenrollmentMessage" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'INFO_REQUEST',
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "visibleToParent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReenrollmentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReenrollmentCampaign_schoolId_status_idx" ON "ReenrollmentCampaign"("schoolId", "status");

-- CreateIndex
CREATE INDEX "ReenrollmentCampaign_schoolId_targetYearId_idx" ON "ReenrollmentCampaign"("schoolId", "targetYearId");

-- CreateIndex
CREATE INDEX "ReenrollmentRequest_schoolId_status_idx" ON "ReenrollmentRequest"("schoolId", "status");

-- CreateIndex
CREATE INDEX "ReenrollmentRequest_schoolId_campaignId_idx" ON "ReenrollmentRequest"("schoolId", "campaignId");

-- CreateIndex
CREATE INDEX "ReenrollmentRequest_campaignId_status_idx" ON "ReenrollmentRequest"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReenrollmentRequest_studentId_targetYearId_key" ON "ReenrollmentRequest"("studentId", "targetYearId");

-- CreateIndex
CREATE INDEX "ReenrollmentMessage_requestId_idx" ON "ReenrollmentMessage"("requestId");

-- CreateIndex
CREATE INDEX "ReenrollmentMessage_schoolId_idx" ON "ReenrollmentMessage"("schoolId");

-- AddForeignKey
ALTER TABLE "ReenrollmentCampaign" ADD CONSTRAINT "ReenrollmentCampaign_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentCampaign" ADD CONSTRAINT "ReenrollmentCampaign_sourceYearId_fkey" FOREIGN KEY ("sourceYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentCampaign" ADD CONSTRAINT "ReenrollmentCampaign_targetYearId_fkey" FOREIGN KEY ("targetYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentCampaign" ADD CONSTRAINT "ReenrollmentCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentRequest" ADD CONSTRAINT "ReenrollmentRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentRequest" ADD CONSTRAINT "ReenrollmentRequest_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ReenrollmentCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentRequest" ADD CONSTRAINT "ReenrollmentRequest_targetYearId_fkey" FOREIGN KEY ("targetYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentRequest" ADD CONSTRAINT "ReenrollmentRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentRequest" ADD CONSTRAINT "ReenrollmentRequest_sourceEnrollmentId_fkey" FOREIGN KEY ("sourceEnrollmentId") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentRequest" ADD CONSTRAINT "ReenrollmentRequest_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentRequest" ADD CONSTRAINT "ReenrollmentRequest_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentRequest" ADD CONSTRAINT "ReenrollmentRequest_desiredLevelId_fkey" FOREIGN KEY ("desiredLevelId") REFERENCES "Level"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentRequest" ADD CONSTRAINT "ReenrollmentRequest_desiredClassroomId_fkey" FOREIGN KEY ("desiredClassroomId") REFERENCES "Classroom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentRequest" ADD CONSTRAINT "ReenrollmentRequest_targetClassroomId_fkey" FOREIGN KEY ("targetClassroomId") REFERENCES "Classroom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentRequest" ADD CONSTRAINT "ReenrollmentRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentRequest" ADD CONSTRAINT "ReenrollmentRequest_newEnrollmentId_fkey" FOREIGN KEY ("newEnrollmentId") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentRequest" ADD CONSTRAINT "ReenrollmentRequest_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentMessage" ADD CONSTRAINT "ReenrollmentMessage_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentMessage" ADD CONSTRAINT "ReenrollmentMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ReenrollmentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentMessage" ADD CONSTRAINT "ReenrollmentMessage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

