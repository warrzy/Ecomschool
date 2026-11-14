-- RH-3 : moteur de paie — additif uniquement.
CREATE TYPE "SalaryComponentKind" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER_CHARGE');
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'VALIDATED', 'POSTED', 'RECTIFIED', 'CANCELLED');

CREATE TABLE "SalaryComponent" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "kind" "SalaryComponentKind" NOT NULL,
  "formula" JSONB NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "activeFrom" TIMESTAMP(3) NOT NULL,
  "activeTo" TIMESTAMP(3),
  "isRegulatory" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalaryComponent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalaryComponent_schoolId_code_version_key" ON "SalaryComponent"("schoolId", "code", "version");
CREATE INDEX "SalaryComponent_schoolId_idx" ON "SalaryComponent"("schoolId");

CREATE TABLE "PayrollRun" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
  "validatedById" TEXT,
  "validatedAt" TIMESTAMP(3),
  "postedEntryId" TEXT,
  "rectifiesRunId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PayrollRun_schoolId_idx" ON "PayrollRun"("schoolId");

CREATE TABLE "Payslip" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "contractId" TEXT,
  "baseSalary" INTEGER NOT NULL,
  "gross" INTEGER NOT NULL,
  "deductions" INTEGER NOT NULL,
  "employerCost" INTEGER NOT NULL DEFAULT 0,
  "net" INTEGER NOT NULL,
  "lines" JSONB NOT NULL,
  "formulaSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payslip_runId_employeeId_key" ON "Payslip"("runId", "employeeId");
CREATE INDEX "Payslip_employeeId_idx" ON "Payslip"("employeeId");
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
