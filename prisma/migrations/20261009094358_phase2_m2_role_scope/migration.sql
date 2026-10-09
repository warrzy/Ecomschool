-- CreateEnum
CREATE TYPE "RoleScope" AS ENUM ('PLATFORM', 'SCHOOL');

-- DropIndex
DROP INDEX "Role_name_key";

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "schoolId" TEXT,
ADD COLUMN     "scope" "RoleScope" NOT NULL DEFAULT 'SCHOOL';

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Role_scope_name_system_key" ON "Role"("scope","name") WHERE "schoolId" IS NULL;

CREATE UNIQUE INDEX "Role_scope_schoolId_name_key" ON "Role"("scope","schoolId","name") WHERE "schoolId" IS NOT NULL;
