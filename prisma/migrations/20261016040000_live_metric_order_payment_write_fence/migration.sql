-- Lock-only serialization is insufficient for a pre-existing RR snapshot.
-- Drain old writers and replace the function atomically before expiring proofs.
BEGIN;
SET LOCAL lock_timeout='5s';
LOCK TABLE public."PaymentTransaction",public."CommerceOrder" IN SHARE ROW EXCLUSIVE MODE;
CREATE OR REPLACE FUNCTION public.wp20_metric_order_payment_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
DECLARE facts JSONB; payment_row RECORD;
BEGIN
 IF TG_LEVEL<>'ROW' OR TG_RELID<>'public."CommerceOrder"'::regclass THEN
  RAISE EXCEPTION 'invalid order payment lock relation' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (NEW."vendorId",NEW."primaryPaymentTransactionId",NEW."createdAt")
  IS NOT DISTINCT FROM (OLD."vendorId",OLD."primaryPaymentTransactionId",OLD."createdAt") THEN RETURN NEW; END IF;
 facts:=(CASE WHEN TG_OP<>'INSERT' THEN jsonb_build_array(to_jsonb(OLD)) ELSE '[]'::jsonb END)
  ||(CASE WHEN TG_OP<>'DELETE' THEN jsonb_build_array(to_jsonb(NEW)) ELSE '[]'::jsonb END);
 FOR payment_row IN SELECT p."vendorId",p.id FROM public."PaymentTransaction" p WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(facts) f
  WHERE p.id=f->>'primaryPaymentTransactionId' AND p."vendorId"=f->>'vendorId'
 ) ORDER BY p."vendorId",p.id LOOP
  -- Write the same value to create a new MVCC tuple without changing payment
  -- facts. Existing payment source triggers ignore unchanged facts. A payment
  -- writer with an older RR/Serializable snapshot must abort with 40001.
  UPDATE public."PaymentTransaction" p SET metadata=p.metadata
   WHERE p."vendorId"=payment_row."vendorId" AND p.id=payment_row.id;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
-- CREATE OR REPLACE preserves the revoked function ACL from migration115.
UPDATE public."LiveMetricVersion" SET "sourceRevision"="sourceRevision"+1;
COMMIT;
