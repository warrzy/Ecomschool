-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReenrollmentProgression" ADD VALUE 'REMEDIAL';
ALTER TYPE "ReenrollmentProgression" ADD VALUE 'DEFERRED';
ALTER TYPE "ReenrollmentProgression" ADD VALUE 'ORIENTATION';
ALTER TYPE "ReenrollmentProgression" ADD VALUE 'EXIT';

-- AlterTable
ALTER TABLE "DeliberationDecision" ADD COLUMN     "finalProgression" "ReenrollmentProgression",
ADD COLUMN     "proposedProgression" "ReenrollmentProgression";

-- AlterTable
ALTER TABLE "StudentAnnualResult" ADD COLUMN     "progression" "ReenrollmentProgression";
