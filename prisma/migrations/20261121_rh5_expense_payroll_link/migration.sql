-- RH-5/M-5 : exclusion anti double comptage des dépenses salariales.
ALTER TABLE "Expense" ADD COLUMN "payrollRunId" TEXT;
