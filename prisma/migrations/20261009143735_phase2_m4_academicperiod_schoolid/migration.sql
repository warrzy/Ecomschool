-- AlterTable
ALTER TABLE "AcademicPeriod" ADD COLUMN     "schoolId" TEXT;

-- CreateIndex
CREATE INDEX "AcademicPeriod_schoolId_idx" ON "AcademicPeriod"("schoolId");

-- AddForeignKey
ALTER TABLE "AcademicPeriod" ADD CONSTRAINT "AcademicPeriod_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

