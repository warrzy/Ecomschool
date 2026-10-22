-- CreateEnum
CREATE TYPE "AdmissionCampaignStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AdmissionApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ADDITIONAL_INFO_REQUIRED', 'WAITLISTED', 'ACCEPTED', 'CONDITIONALLY_ACCEPTED', 'REJECTED', 'CONVERTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "AdmissionCampaign" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "status" "AdmissionCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "targetLevelIds" JSONB,
    "trainingOptions" JSONB,
    "requiredDocs" JSONB NOT NULL DEFAULT '[]',
    "capacity" INTEGER,
    "applicationFee" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionApplication" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "fileNumber" TEXT NOT NULL,
    "trackingHash" TEXT NOT NULL,
    "submissionGroupId" TEXT NOT NULL,
    "fingerprint" TEXT,
    "duplicateOfId" TEXT,
    "status" "AdmissionApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "candidateFirstName" TEXT NOT NULL,
    "candidateLastName" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "birthPlace" TEXT,
    "sex" "Gender",
    "previousSchool" TEXT,
    "selfApplicant" BOOLEAN NOT NULL DEFAULT false,
    "targetLevelId" TEXT,
    "targetClassroomId" TEXT,
    "targetTraining" TEXT,
    "extraInfo" JSONB,
    "guardianFirstName" TEXT,
    "guardianLastName" TEXT,
    "guardianRelation" TEXT,
    "guardianPhone" TEXT NOT NULL,
    "guardianEmail" TEXT,
    "guardianAddress" TEXT,
    "secondaryContact" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedIp" TEXT,
    "infoRequestNote" TEXT,
    "decisionReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "studentId" TEXT,
    "guardianId" TEXT,
    "enrollmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionEvent" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fromStatus" "AdmissionApplicationStatus",
    "toStatus" "AdmissionApplicationStatus" NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionMessage" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'INFO_REQUEST',
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "visibleToApplicant" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdmissionCampaign_schoolId_status_idx" ON "AdmissionCampaign"("schoolId", "status");

-- CreateIndex
CREATE INDEX "AdmissionCampaign_academicYearId_idx" ON "AdmissionCampaign"("academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionApplication_fileNumber_key" ON "AdmissionApplication"("fileNumber");

-- CreateIndex
CREATE INDEX "AdmissionApplication_schoolId_campaignId_status_idx" ON "AdmissionApplication"("schoolId", "campaignId", "status");

-- CreateIndex
CREATE INDEX "AdmissionApplication_schoolId_status_idx" ON "AdmissionApplication"("schoolId", "status");

-- CreateIndex
CREATE INDEX "AdmissionApplication_submissionGroupId_idx" ON "AdmissionApplication"("submissionGroupId");

-- CreateIndex
CREATE INDEX "AdmissionApplication_trackingHash_idx" ON "AdmissionApplication"("trackingHash");

-- CreateIndex
CREATE INDEX "AdmissionEvent_applicationId_idx" ON "AdmissionEvent"("applicationId");

-- CreateIndex
CREATE INDEX "AdmissionEvent_schoolId_idx" ON "AdmissionEvent"("schoolId");

-- CreateIndex
CREATE INDEX "AdmissionMessage_applicationId_idx" ON "AdmissionMessage"("applicationId");

-- CreateIndex
CREATE INDEX "AdmissionMessage_schoolId_idx" ON "AdmissionMessage"("schoolId");

-- AddForeignKey
ALTER TABLE "AdmissionCampaign" ADD CONSTRAINT "AdmissionCampaign_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionCampaign" ADD CONSTRAINT "AdmissionCampaign_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AdmissionCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_targetLevelId_fkey" FOREIGN KEY ("targetLevelId") REFERENCES "Level"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_targetClassroomId_fkey" FOREIGN KEY ("targetClassroomId") REFERENCES "Classroom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionEvent" ADD CONSTRAINT "AdmissionEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionEvent" ADD CONSTRAINT "AdmissionEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionMessage" ADD CONSTRAINT "AdmissionMessage_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionMessage" ADD CONSTRAINT "AdmissionMessage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
