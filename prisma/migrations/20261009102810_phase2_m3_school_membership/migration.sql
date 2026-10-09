/*
  Warnings:

  - Added the required column `roleId` to the `SchoolMembership` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SchoolMembership" ADD COLUMN     "roleId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "SchoolMembership_roleId_idx" ON "SchoolMembership"("roleId");

-- AddForeignKey
ALTER TABLE "SchoolMembership" ADD CONSTRAINT "SchoolMembership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
