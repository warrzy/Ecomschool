-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'OPEN', 'SUBMITTED', 'VALIDATED', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GradeStatus" AS ENUM ('ENTERED', 'MISSING', 'ABSENT', 'EXEMPT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('DRAFT', 'CALCULATED', 'PENDING_VALIDATION', 'VALIDATED', 'PUBLISHED', 'RECTIFIED');

-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('HALF_UP', 'FLOOR', 'CEIL');

-- CreateEnum
CREATE TYPE "TieRule" AS ENUM ('SHARED_RANK', 'DENSE_RANK');

-- CreateEnum
CREATE TYPE "MissingGradePolicy" AS ENUM ('EXCLUDE', 'ZERO');

-- CreateTable
CREATE TABLE "GradingPolicy" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "levelId" TEXT,
    "maxScore" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "minScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "precision" INTEGER NOT NULL DEFAULT 2,
    "rounding" "RoundingMode" NOT NULL DEFAULT 'HALF_UP',
    "passMark" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "missingGradePolicy" "MissingGradePolicy" NOT NULL DEFAULT 'EXCLUDE',
    "absentPolicy" "MissingGradePolicy" NOT NULL DEFAULT 'EXCLUDE',
    "exemptPolicy" "MissingGradePolicy" NOT NULL DEFAULT 'EXCLUDE',
    "tieRule" "TieRule" NOT NULL DEFAULT 'SHARED_RANK',
    "perSubjectRank" BOOLEAN NOT NULL DEFAULT true,
    "mentions" JSONB,
    "annualWeights" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentType" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultCoefficient" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "academicPeriodId" TEXT,
    "classroomId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT,
    "typeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "coefficient" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "description" TEXT,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grade" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "status" "GradeStatus" NOT NULL DEFAULT 'MISSING',
    "observation" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeRevision" (
    "id" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "oldValue" DOUBLE PRECISION,
    "newValue" DOUBLE PRECISION,
    "oldStatus" "GradeStatus" NOT NULL,
    "newStatus" "GradeStatus" NOT NULL,
    "reason" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubjectPeriodResult" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicPeriodId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "average" DOUBLE PRECISION,
    "coefficient" DOUBLE PRECISION,
    "weightedPoints" DOUBLE PRECISION,
    "rank" INTEGER,
    "appreciation" TEXT,
    "isComplete" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubjectPeriodResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentPeriodResult" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicPeriodId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "generalAverage" DOUBLE PRECISION,
    "totalCoefficients" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subjectsCount" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "mention" TEXT,
    "isComplete" BOOLEAN NOT NULL DEFAULT true,
    "status" "ResultStatus" NOT NULL DEFAULT 'DRAFT',
    "computedAt" TIMESTAMP(3),
    "computedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentPeriodResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentAnnualResult" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "annualAverage" DOUBLE PRECISION,
    "rank" INTEGER,
    "mention" TEXT,
    "decision" TEXT,
    "status" "ResultStatus" NOT NULL DEFAULT 'DRAFT',
    "computedAt" TIMESTAMP(3),
    "computedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentAnnualResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultValidation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "academicPeriodId" TEXT NOT NULL,
    "status" "ResultStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "computedById" TEXT,
    "computedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResultValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCard" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "academicPeriodId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "ResultStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "templateKey" TEXT NOT NULL DEFAULT 'standard',
    "generatedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCardVersion" (
    "id" TEXT NOT NULL,
    "reportCardId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportCardVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCardTemplate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "levelId" TEXT,
    "layout" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportCardTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GradingPolicy_schoolId_idx" ON "GradingPolicy"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "GradingPolicy_academicYearId_levelId_key" ON "GradingPolicy"("academicYearId", "levelId");

-- CreateIndex
CREATE INDEX "AssessmentType_schoolId_idx" ON "AssessmentType"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentType_schoolId_code_key" ON "AssessmentType"("schoolId", "code");

-- CreateIndex
CREATE INDEX "Assessment_schoolId_idx" ON "Assessment"("schoolId");

-- CreateIndex
CREATE INDEX "Assessment_classroomId_idx" ON "Assessment"("classroomId");

-- CreateIndex
CREATE INDEX "Assessment_academicPeriodId_idx" ON "Assessment"("academicPeriodId");

-- CreateIndex
CREATE INDEX "Assessment_teacherId_idx" ON "Assessment"("teacherId");

-- CreateIndex
CREATE INDEX "Assessment_schoolId_status_idx" ON "Assessment"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Grade_schoolId_idx" ON "Grade"("schoolId");

-- CreateIndex
CREATE INDEX "Grade_studentId_idx" ON "Grade"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Grade_assessmentId_studentId_key" ON "Grade"("assessmentId", "studentId");

-- CreateIndex
CREATE INDEX "GradeRevision_gradeId_idx" ON "GradeRevision"("gradeId");

-- CreateIndex
CREATE INDEX "SubjectPeriodResult_schoolId_idx" ON "SubjectPeriodResult"("schoolId");

-- CreateIndex
CREATE INDEX "SubjectPeriodResult_classroomId_idx" ON "SubjectPeriodResult"("classroomId");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectPeriodResult_academicPeriodId_studentId_subjectId_key" ON "SubjectPeriodResult"("academicPeriodId", "studentId", "subjectId");

-- CreateIndex
CREATE INDEX "StudentPeriodResult_schoolId_idx" ON "StudentPeriodResult"("schoolId");

-- CreateIndex
CREATE INDEX "StudentPeriodResult_classroomId_idx" ON "StudentPeriodResult"("classroomId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentPeriodResult_academicPeriodId_studentId_key" ON "StudentPeriodResult"("academicPeriodId", "studentId");

-- CreateIndex
CREATE INDEX "StudentAnnualResult_schoolId_idx" ON "StudentAnnualResult"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentAnnualResult_academicYearId_studentId_key" ON "StudentAnnualResult"("academicYearId", "studentId");

-- CreateIndex
CREATE INDEX "ResultValidation_schoolId_idx" ON "ResultValidation"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultValidation_classroomId_academicPeriodId_key" ON "ResultValidation"("classroomId", "academicPeriodId");

-- CreateIndex
CREATE INDEX "ReportCard_schoolId_idx" ON "ReportCard"("schoolId");

-- CreateIndex
CREATE INDEX "ReportCard_classroomId_idx" ON "ReportCard"("classroomId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCard_schoolId_identifier_key" ON "ReportCard"("schoolId", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCard_academicPeriodId_studentId_key" ON "ReportCard"("academicPeriodId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCardVersion_reportCardId_version_key" ON "ReportCardVersion"("reportCardId", "version");

-- CreateIndex
CREATE INDEX "ReportCardTemplate_schoolId_idx" ON "ReportCardTemplate"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCardTemplate_schoolId_key_key" ON "ReportCardTemplate"("schoolId", "key");

-- AddForeignKey
ALTER TABLE "GradingPolicy" ADD CONSTRAINT "GradingPolicy_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingPolicy" ADD CONSTRAINT "GradingPolicy_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingPolicy" ADD CONSTRAINT "GradingPolicy_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentType" ADD CONSTRAINT "AssessmentType_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_academicPeriodId_fkey" FOREIGN KEY ("academicPeriodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "AssessmentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeRevision" ADD CONSTRAINT "GradeRevision_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeRevision" ADD CONSTRAINT "GradeRevision_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectPeriodResult" ADD CONSTRAINT "SubjectPeriodResult_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectPeriodResult" ADD CONSTRAINT "SubjectPeriodResult_academicPeriodId_fkey" FOREIGN KEY ("academicPeriodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectPeriodResult" ADD CONSTRAINT "SubjectPeriodResult_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectPeriodResult" ADD CONSTRAINT "SubjectPeriodResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectPeriodResult" ADD CONSTRAINT "SubjectPeriodResult_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPeriodResult" ADD CONSTRAINT "StudentPeriodResult_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPeriodResult" ADD CONSTRAINT "StudentPeriodResult_academicPeriodId_fkey" FOREIGN KEY ("academicPeriodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPeriodResult" ADD CONSTRAINT "StudentPeriodResult_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPeriodResult" ADD CONSTRAINT "StudentPeriodResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAnnualResult" ADD CONSTRAINT "StudentAnnualResult_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAnnualResult" ADD CONSTRAINT "StudentAnnualResult_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAnnualResult" ADD CONSTRAINT "StudentAnnualResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultValidation" ADD CONSTRAINT "ResultValidation_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultValidation" ADD CONSTRAINT "ResultValidation_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultValidation" ADD CONSTRAINT "ResultValidation_academicPeriodId_fkey" FOREIGN KEY ("academicPeriodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultValidation" ADD CONSTRAINT "ResultValidation_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultValidation" ADD CONSTRAINT "ResultValidation_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_academicPeriodId_fkey" FOREIGN KEY ("academicPeriodId") REFERENCES "AcademicPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCardVersion" ADD CONSTRAINT "ReportCardVersion_reportCardId_fkey" FOREIGN KEY ("reportCardId") REFERENCES "ReportCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCardVersion" ADD CONSTRAINT "ReportCardVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCardTemplate" ADD CONSTRAINT "ReportCardTemplate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCardTemplate" ADD CONSTRAINT "ReportCardTemplate_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index partiel : une seule GradingPolicy par défaut par année scolaire (levelId IS NULL)
CREATE UNIQUE INDEX "GradingPolicy_default_per_year_key"
ON "GradingPolicy"("academicYearId")
WHERE "levelId" IS NULL;
