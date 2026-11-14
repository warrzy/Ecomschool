-- RH-9 : règles de dotation congés + config paie — additif uniquement.
CREATE TABLE "LeaveRule" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "type" "LeaveType" NOT NULL,
  "entitledDays" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeaveRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeaveRule_schoolId_type_key" ON "LeaveRule"("schoolId", "type");
CREATE INDEX "LeaveRule_schoolId_idx" ON "LeaveRule"("schoolId");

CREATE TABLE "PayrollConfig" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "advanceCapBp" INTEGER NOT NULL DEFAULT 3000,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayrollConfig_schoolId_key" ON "PayrollConfig"("schoolId");
