-- CreateEnum
CREATE TYPE "AdminRequestType" AS ENUM ('DOCUMENT', 'ABSENCE_JUSTIFICATION', 'ACCOUNT_INFO', 'MEETING', 'OTHER');

-- CreateEnum
CREATE TYPE "AdminRequestStatus" AS ENUM ('SUBMITTED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AdministrativeRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "studentId" TEXT,
    "type" "AdminRequestType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "contextRef" TEXT,
    "status" "AdminRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "response" TEXT,
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdministrativeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdministrativeRequest_schoolId_guardianId_idx" ON "AdministrativeRequest"("schoolId", "guardianId");

-- CreateIndex
CREATE INDEX "AdministrativeRequest_schoolId_status_idx" ON "AdministrativeRequest"("schoolId", "status");

-- CreateIndex
CREATE INDEX "AdministrativeRequest_studentId_idx" ON "AdministrativeRequest"("studentId");

-- AddForeignKey
ALTER TABLE "AdministrativeRequest" ADD CONSTRAINT "AdministrativeRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdministrativeRequest" ADD CONSTRAINT "AdministrativeRequest_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdministrativeRequest" ADD CONSTRAINT "AdministrativeRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
