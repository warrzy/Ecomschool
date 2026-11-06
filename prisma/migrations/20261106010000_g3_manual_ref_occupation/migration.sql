-- Anti-doublon renforcé : une référence opérateur déjà comptabilisée
-- (receiptNumber non nul) reste occupée même si le paiement validé est
-- annulé — impossible de comptabiliser deux fois la même transaction.
-- Seuls les rejets avant validation (receiptNumber NULL) libèrent la
-- référence pour ressaisie.
DROP INDEX "Payment_manual_momo_ref_key";
CREATE UNIQUE INDEX "Payment_manual_momo_ref_key" ON "Payment"("schoolId", "mobileMoneyOperator", "reference")
WHERE "mobileMoneyOperator" IS NOT NULL
  AND ("status" <> 'CANCELLED' OR "receiptNumber" IS NOT NULL);
