-- CreateEnum
CREATE TYPE "AdminDocumentType" AS ENUM ('ATTESTATION_INSCRIPTION', 'CERTIFICAT_SCOLAIRE', 'CARTE_SCOLAIRE');

-- CreateEnum
CREATE TYPE "AdminDocumentStatus" AS ENUM ('ISSUED', 'REVOKED');

-- CreateTable
CREATE TABLE "AdministrativeDocument" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "type" "AdminDocumentType" NOT NULL,
    "number" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "status" "AdminDocumentStatus" NOT NULL DEFAULT 'ISSUED',
    "publicCode" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "replacedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdministrativeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdministrativeDocument_publicCode_key" ON "AdministrativeDocument"("publicCode");

-- CreateIndex
CREATE INDEX "AdministrativeDocument_schoolId_studentId_idx" ON "AdministrativeDocument"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "AdministrativeDocument_schoolId_status_idx" ON "AdministrativeDocument"("schoolId", "status");

-- CreateIndex
CREATE INDEX "AdministrativeDocument_academicYearId_idx" ON "AdministrativeDocument"("academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "AdministrativeDocument_schoolId_number_key" ON "AdministrativeDocument"("schoolId", "number");

-- AddForeignKey
ALTER TABLE "AdministrativeDocument" ADD CONSTRAINT "AdministrativeDocument_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdministrativeDocument" ADD CONSTRAINT "AdministrativeDocument_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdministrativeDocument" ADD CONSTRAINT "AdministrativeDocument_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
