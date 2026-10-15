-- P3 : cycle de vie des politiques de notation (brouillon / active / archivée).
-- Enum dédié : RecordStatus est partagé par ~20 modèles, on n'y ajoute pas DRAFT.
CREATE TYPE "GradingPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- Conversion de la colonne : ACTIVE/ARCHIVED mappées 1:1, aucune perte de données.
ALTER TABLE "GradingPolicy" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "GradingPolicy" ALTER COLUMN "status" TYPE "GradingPolicyStatus"
  USING ("status"::text::"GradingPolicyStatus");
ALTER TABLE "GradingPolicy" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- L'unicité stricte (année, niveau) interdisait la coexistence brouillon+active.
-- Remplacée par des index partiels : 1 ACTIVE max + 1 DRAFT max par périmètre,
-- ARCHIVED illimitées (historique).
DROP INDEX "GradingPolicy_academicYearId_levelId_key";
DROP INDEX "GradingPolicy_default_per_year_key";

CREATE UNIQUE INDEX "GradingPolicy_active_year_level_key"
  ON "GradingPolicy"("academicYearId", "levelId")
  WHERE "status" = 'ACTIVE' AND "levelId" IS NOT NULL;
CREATE UNIQUE INDEX "GradingPolicy_active_year_default_key"
  ON "GradingPolicy"("academicYearId")
  WHERE "status" = 'ACTIVE' AND "levelId" IS NULL;
CREATE UNIQUE INDEX "GradingPolicy_draft_year_level_key"
  ON "GradingPolicy"("academicYearId", "levelId")
  WHERE "status" = 'DRAFT' AND "levelId" IS NOT NULL;
CREATE UNIQUE INDEX "GradingPolicy_draft_year_default_key"
  ON "GradingPolicy"("academicYearId")
  WHERE "status" = 'DRAFT' AND "levelId" IS NULL;
