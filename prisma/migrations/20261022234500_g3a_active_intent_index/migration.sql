-- Une seule intention ACTIVE par opération métier (élève, année, échéance cible).
-- Les échéances distinctes, les paiements partiels successifs et les nouvelles
-- tentatives après échec/expiration/annulation restent autorisés ; les états
-- terminaux (CONFIRMED, FAILED, EXPIRED, CANCELLED) n'occupent pas l'index.
CREATE UNIQUE INDEX "payment_intent_one_active_per_op"
  ON "PaymentIntent" ("schoolId", "studentId", "academicYearId", COALESCE("feeInstallmentId", ''))
  WHERE "status" IN ('CREATED', 'PENDING', 'CONFIRMED_PENDING_POSTING');
