-- CreateEnum
CREATE TYPE "ExerciseStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AccountingEntryStatus" AS ENUM ('POSTED', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "AccountingEntryOrigin" AS ENUM ('REAL', 'SIMULATION');

-- CreateTable
CREATE TABLE "AccountingAccount" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classNumber" INTEGER NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingJournal" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "defaultAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingExercise" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "ExerciseStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "status" "AccountingEntryStatus" NOT NULL DEFAULT 'POSTED',
    "origin" "AccountingEntryOrigin" NOT NULL DEFAULT 'REAL',
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingEntryLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" INTEGER NOT NULL DEFAULT 0,
    "credit" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AccountingEntryLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingAccountMap" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingAccountMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountingAccount_schoolId_idx" ON "AccountingAccount"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingAccount_schoolId_code_key" ON "AccountingAccount"("schoolId", "code");

-- CreateIndex
CREATE INDEX "AccountingJournal_schoolId_idx" ON "AccountingJournal"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingJournal_schoolId_code_key" ON "AccountingJournal"("schoolId", "code");

-- CreateIndex
CREATE INDEX "AccountingExercise_schoolId_idx" ON "AccountingExercise"("schoolId");

-- CreateIndex
CREATE INDEX "AccountingEntry_schoolId_idx" ON "AccountingEntry"("schoolId");

-- CreateIndex
CREATE INDEX "AccountingEntry_exerciseId_idx" ON "AccountingEntry"("exerciseId");

-- CreateIndex
CREATE INDEX "AccountingEntry_journalId_idx" ON "AccountingEntry"("journalId");

-- CreateIndex
CREATE INDEX "AccountingEntry_date_idx" ON "AccountingEntry"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingEntry_schoolId_reference_key" ON "AccountingEntry"("schoolId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingEntry_schoolId_sourceType_sourceId_key" ON "AccountingEntry"("schoolId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "AccountingEntryLine_entryId_idx" ON "AccountingEntryLine"("entryId");

-- CreateIndex
CREATE INDEX "AccountingEntryLine_accountId_idx" ON "AccountingEntryLine"("accountId");

-- CreateIndex
CREATE INDEX "AccountingAccountMap_schoolId_idx" ON "AccountingAccountMap"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingAccountMap_schoolId_key_key" ON "AccountingAccountMap"("schoolId", "key");

-- AddForeignKey
ALTER TABLE "AccountingJournal" ADD CONSTRAINT "AccountingJournal_defaultAccountId_fkey" FOREIGN KEY ("defaultAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntry" ADD CONSTRAINT "AccountingEntry_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "AccountingJournal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntry" ADD CONSTRAINT "AccountingEntry_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "AccountingExercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntryLine" ADD CONSTRAINT "AccountingEntryLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "AccountingEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingEntryLine" ADD CONSTRAINT "AccountingEntryLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingAccountMap" ADD CONSTRAINT "AccountingAccountMap_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
