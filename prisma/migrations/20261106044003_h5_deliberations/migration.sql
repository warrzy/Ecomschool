-- CreateEnum
CREATE TYPE "DeliberationScope" AS ENUM ('PERIOD', 'ANNUAL');

-- CreateEnum
CREATE TYPE "DeliberationStatus" AS ENUM ('OPEN', 'VALIDATED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "DeliberationDecisionStatus" AS ENUM ('PROPOSED', 'ADJUSTED', 'VALIDATED');

-- CreateTable
CREATE TABLE "DeliberationRule" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT,
    "levelId" TEXT,
    "scope" "DeliberationScope" NOT NULL,
    "label" TEXT NOT NULL,
    "progression" "ReenrollmentProgression",
    "minAverage" DOUBLE PRECISION,
    "maxAverage" DOUBLE PRECISION,
    "requiresComplete" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliberationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliberationSession" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "scope" "DeliberationScope" NOT NULL,
    "academicPeriodId" TEXT,
    "classroomId" TEXT NOT NULL,
    "status" "DeliberationStatus" NOT NULL DEFAULT 'OPEN',
    "number" TEXT NOT NULL,
    "note" TEXT,
    "preparedById" TEXT,
    "preparedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "unlockedById" TEXT,
    "unlockedAt" TIMESTAMP(3),
    "unlockReason" TEXT,
    "depublishReason" TEXT,
    "depublishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliberationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliberationDecision" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "averageSnapshot" DOUBLE PRECISION,
    "rankSnapshot" INTEGER,
    "mentionSnapshot" TEXT,
    "completeSnapshot" BOOLEAN NOT NULL DEFAULT true,
    "proposedRuleId" TEXT,
    "proposedLabel" TEXT,
    "finalRuleId" TEXT,
    "finalLabel" TEXT,
    "adjustmentReason" TEXT,
    "status" "DeliberationDecisionStatus" NOT NULL DEFAULT 'PROPOSED',
    "adjustedById" TEXT,
    "adjustedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliberationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliberationRule_schoolId_scope_status_idx" ON "DeliberationRule"("schoolId", "scope", "status");

-- CreateIndex
CREATE INDEX "DeliberationRule_academicYearId_idx" ON "DeliberationRule"("academicYearId");

-- CreateIndex
CREATE INDEX "DeliberationRule_levelId_idx" ON "DeliberationRule"("levelId");

-- CreateIndex
CREATE INDEX "DeliberationSession_schoolId_idx" ON "DeliberationSession"("schoolId");

-- CreateIndex
CREATE INDEX "DeliberationSession_schoolId_status_idx" ON "DeliberationSession"("schoolId", "status");

-- CreateIndex
CREATE INDEX "DeliberationSession_academicYearId_idx" ON "DeliberationSession"("academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliberationSession_classroomId_academicPeriodId_key" ON "DeliberationSession"("classroomId", "academicPeriodId");

-- CreateIndex
CREATE INDEX "DeliberationDecision_schoolId_idx" ON "DeliberationDecision"("schoolId");

-- CreateIndex
CREATE INDEX "DeliberationDecision_studentId_idx" ON "DeliberationDecision"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliberationDecision_sessionId_studentId_key" ON "DeliberationDecision"("sessionId", "studentId");

-- AddForeignKey
ALTER TABLE "DeliberationRule" ADD CONSTRAINT "DeliberationRule_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliberationRule" ADD CONSTRAINT "DeliberationRule_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliberationRule" ADD CONSTRAINT "DeliberationRule_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliberationSession" ADD CONSTRAINT "DeliberationSession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliberationSession" ADD CONSTRAINT "DeliberationSession_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliberationSession" ADD CONSTRAINT "DeliberationSession_academicPeriodId_fkey" FOREIGN KEY ("academicPeriodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliberationSession" ADD CONSTRAINT "DeliberationSession_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliberationDecision" ADD CONSTRAINT "DeliberationDecision_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliberationDecision" ADD CONSTRAINT "DeliberationDecision_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DeliberationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliberationDecision" ADD CONSTRAINT "DeliberationDecision_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliberationDecision" ADD CONSTRAINT "DeliberationDecision_proposedRuleId_fkey" FOREIGN KEY ("proposedRuleId") REFERENCES "DeliberationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliberationDecision" ADD CONSTRAINT "DeliberationDecision_finalRuleId_fkey" FOREIGN KEY ("finalRuleId") REFERENCES "DeliberationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Unicité des sessions ANNUAL : la contrainte (classroomId,
-- academicPeriodId) ne couvre pas les lignes à academicPeriodId NULL.
CREATE UNIQUE INDEX "deliberation_session_annual_unique"
    ON "DeliberationSession" ("schoolId", "classroomId", "academicYearId")
    WHERE "scope" = 'ANNUAL';
