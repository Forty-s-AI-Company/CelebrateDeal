-- Historical unsigned rows remain readable; new service quotes must bind the
-- immutable ledger. NULL legacy quotes can never be signed/exported by it.
ALTER TABLE "AffiliateRemunerationSnapshot" ADD COLUMN "ledgerDigest" TEXT;
ALTER TABLE "AffiliateRemunerationSnapshot" ADD CONSTRAINT "AffiliateRemunerationSnapshot_digest_check" CHECK ("ledgerDigest" IS NULL OR "ledgerDigest" ~ '^[a-f0-9]{64}$');

-- Amounts, recipient identity, rule and ledger binding never change in place.
-- Preserve signed history; retries use the existing row, never overwrite it.
CREATE FUNCTION affiliate_remuneration_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'remuneration snapshot history is immutable'; END IF;
  IF (to_jsonb(NEW) - ARRAY['status','signedByUserId','signedAt','invalidatedAt','exportedAt']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','signedByUserId','signedAt','invalidatedAt','exportedAt']) THEN
    RAISE EXCEPTION 'remuneration snapshot payload is immutable';
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF NOT ((OLD."status" = 'quoted' AND NEW."status" IN ('signed','invalidated')) OR
          (OLD."status" = 'signed' AND NEW."status" IN ('invalidated','exported'))) THEN
    RAISE EXCEPTION 'remuneration snapshot transition rejected';
  END IF;
  IF NOT (OLD."status" = 'quoted' AND NEW."status" = 'signed') AND
     (NEW."signedByUserId" IS DISTINCT FROM OLD."signedByUserId" OR NEW."signedAt" IS DISTINCT FROM OLD."signedAt") THEN
    RAISE EXCEPTION 'remuneration signature is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER affiliate_remuneration_snapshot_guard BEFORE UPDATE OR DELETE ON "AffiliateRemunerationSnapshot" FOR EACH ROW EXECUTE FUNCTION affiliate_remuneration_snapshot_guard();
