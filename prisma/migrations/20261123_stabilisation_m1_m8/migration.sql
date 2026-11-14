ALTER TABLE "PayrollConfig" ADD COLUMN "workdaysPerMonth" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "PayrollConfig" ADD COLUMN "prorateUnpaidLeave" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PayrollConfig" ADD COLUMN "prorateAbsences" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payslip" ADD COLUMN "daysWorked" INTEGER;
ALTER TABLE "Payslip" ADD COLUMN "unpaidDays" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "idempotencyHash" TEXT;
