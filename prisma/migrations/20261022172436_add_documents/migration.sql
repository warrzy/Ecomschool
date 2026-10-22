-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'REPLACED', 'DELETED', 'PURGED');

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL DEFAULT 'STANDALONE',
    "ownerId" TEXT,
    "category" TEXT NOT NULL,
    "label" TEXT,
    "description" TEXT,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "replacedById" TEXT,
    "replacedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deleteReason" TEXT,
    "purgedAt" TIMESTAMP(3),
    "uploadedById" TEXT,
    "uploadedByIp" TEXT,
    "accessToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_accessToken_key" ON "Document"("accessToken");

-- CreateIndex
CREATE INDEX "Document_schoolId_status_idx" ON "Document"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Document_schoolId_ownerType_ownerId_idx" ON "Document"("schoolId", "ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "Document_sha256_idx" ON "Document"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "Document_schoolId_fileName_key" ON "Document"("schoolId", "fileName");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
