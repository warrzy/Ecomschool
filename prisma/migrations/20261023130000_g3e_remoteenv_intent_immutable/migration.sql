-- G3-E Phase 3C — l'environnement distant d'une intention est FIGE a
-- la creation : aucun service ne peut le modifier ensuite. Protection
-- au niveau base (additive, les lignes historiques ne sont pas touchees).
CREATE OR REPLACE FUNCTION payment_intent_remoteenv_immutable()
RETURNS trigger AS $$
BEGIN
  IF NEW."remoteEnv" IS DISTINCT FROM OLD."remoteEnv" THEN
    RAISE EXCEPTION 'REMOTE_ENV_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payment_intent_remoteenv
  BEFORE UPDATE ON "PaymentIntent"
  FOR EACH ROW EXECUTE FUNCTION payment_intent_remoteenv_immutable();
