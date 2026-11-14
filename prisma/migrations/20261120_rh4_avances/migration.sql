-- RH-4 : avances sur salaire — additif uniquement.
CREATE TYPE "AdvanceStatus" AS ENUM ('GRANTED', 'RECOVERING', 'RECOVERED', 'CANCELLED');

CREATE TABLE "Advance" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "remaining" INTEGER NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "status" "AdvanceStatus" NOT NULL DEFAULT 'GRANTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Advance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Advance_schoolId_idx" ON "Advance"("schoolId");
CREATE INDEX "Advance_employeeId_idx" ON "Advance"("employeeId");
ALTER TABLE "Advance" ADD CONSTRAINT "Advance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AdvanceRecovery" (
  "id" TEXT NOT NULL,
  "advanceId" TEXT NOT NULL,
  "payslipId" TEXT,
  "amount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdvanceRecovery_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdvanceRecovery_advanceId_idx" ON "AdvanceRecovery"("advanceId");
ALTER TABLE "AdvanceRecovery" ADD CONSTRAINT "AdvanceRecovery_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "Advance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
