-- CG-4 : une dotation par immobilisation et par période (idempotence).
CREATE UNIQUE INDEX "AssetSchedule_assetId_periodStart_key"
  ON "AssetSchedule"("assetId", "periodStart");
