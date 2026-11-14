-- CG-1 : comptabilité générale — purement additif, aucune donnée modifiée.

CREATE TYPE "ExerciseMode" AS ENUM ('CASH', 'ACCRUAL');
CREATE TYPE "ThirdPartyKind" AS ENUM ('STUDENT', 'SUPPLIER', 'STAFF', 'OTHER');
CREATE TYPE "DepreciationMethod" AS ENUM ('LINEAR', 'DECLINING');
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'SOLD', 'SCRAPPED');

ALTER TABLE "AccountingExercise" ADD COLUMN "mode" "ExerciseMode" NOT NULL DEFAULT 'CASH';
ALTER TABLE "AccountingEntryLine" ADD COLUMN "thirdPartyId" TEXT;
CREATE INDEX "AccountingEntryLine_thirdPartyId_idx" ON "AccountingEntryLine"("thirdPartyId");

CREATE TABLE "AccountingThirdParty" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "kind" "ThirdPartyKind" NOT NULL,
    "refId" TEXT,
    "name" TEXT NOT NULL,
    "collectiveAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountingThirdParty_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountingThirdParty_schoolId_kind_refId_key" ON "AccountingThirdParty"("schoolId", "kind", "refId");
CREATE INDEX "AccountingThirdParty_schoolId_idx" ON "AccountingThirdParty"("schoolId");

CREATE TABLE "AccountingAllocation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "chargeLineId" TEXT NOT NULL,
    "paymentLineId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "thirdPartyId" TEXT,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountingAllocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountingAllocation_chargeLineId_paymentLineId_key" ON "AccountingAllocation"("chargeLineId", "paymentLineId");
CREATE INDEX "AccountingAllocation_schoolId_idx" ON "AccountingAllocation"("schoolId");

CREATE TABLE "AccountingAsset" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "acquisitionDate" TIMESTAMP(3) NOT NULL,
    "acquisitionCost" INTEGER NOT NULL,
    "method" "DepreciationMethod" NOT NULL DEFAULT 'LINEAR',
    "durationMonths" INTEGER NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "accountAssetId" TEXT NOT NULL,
    "accountDepreciationId" TEXT NOT NULL,
    "accountChargeId" TEXT NOT NULL,
    "entryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountingAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountingAsset_entryId_key" ON "AccountingAsset"("entryId");
CREATE INDEX "AccountingAsset_schoolId_idx" ON "AccountingAsset"("schoolId");

CREATE TABLE "AssetSchedule" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "entryId" TEXT,
    CONSTRAINT "AssetSchedule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AssetSchedule_entryId_key" ON "AssetSchedule"("entryId");
CREATE INDEX "AssetSchedule_assetId_idx" ON "AssetSchedule"("assetId");

CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "closingBalance" INTEGER NOT NULL,
    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BankStatement_schoolId_idx" ON "BankStatement"("schoolId");

CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "matchedEntryLineId" TEXT,
    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BankStatementLine_statementId_idx" ON "BankStatementLine"("statementId");

ALTER TABLE "AccountingEntryLine" ADD CONSTRAINT "AccountingEntryLine_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "AccountingThirdParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountingThirdParty" ADD CONSTRAINT "AccountingThirdParty_collectiveAccountId_fkey" FOREIGN KEY ("collectiveAccountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingAllocation" ADD CONSTRAINT "AccountingAllocation_chargeLineId_fkey" FOREIGN KEY ("chargeLineId") REFERENCES "AccountingEntryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingAllocation" ADD CONSTRAINT "AccountingAllocation_paymentLineId_fkey" FOREIGN KEY ("paymentLineId") REFERENCES "AccountingEntryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingAllocation" ADD CONSTRAINT "AccountingAllocation_thirdPartyId_fkey" FOREIGN KEY ("thirdPartyId") REFERENCES "AccountingThirdParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountingAsset" ADD CONSTRAINT "AccountingAsset_accountAssetId_fkey" FOREIGN KEY ("accountAssetId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingAsset" ADD CONSTRAINT "AccountingAsset_accountDepreciationId_fkey" FOREIGN KEY ("accountDepreciationId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingAsset" ADD CONSTRAINT "AccountingAsset_accountChargeId_fkey" FOREIGN KEY ("accountChargeId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssetSchedule" ADD CONSTRAINT "AssetSchedule_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "AccountingAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "AccountingJournal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
