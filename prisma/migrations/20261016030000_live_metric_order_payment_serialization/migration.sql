-- Serialize changes to the payment/window relation with payment metadata writes.
-- SHARE conflicts with UPDATE's NO KEY UPDATE lock; KEY SHARE would not suffice.
CREATE FUNCTION public.wp20_metric_order_payment_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE facts JSONB;
BEGIN
 IF TG_LEVEL<>'ROW' OR TG_RELID<>'public."CommerceOrder"'::regclass THEN
  RAISE EXCEPTION 'invalid order payment lock relation' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (NEW."vendorId",NEW."primaryPaymentTransactionId",NEW."createdAt")
  IS NOT DISTINCT FROM (OLD."vendorId",OLD."primaryPaymentTransactionId",OLD."createdAt") THEN RETURN NEW; END IF;
 facts:=(CASE WHEN TG_OP<>'INSERT' THEN jsonb_build_array(to_jsonb(OLD)) ELSE '[]'::jsonb END)
  ||(CASE WHEN TG_OP<>'DELETE' THEN jsonb_build_array(to_jsonb(NEW)) ELSE '[]'::jsonb END);
 PERFORM p.id FROM public."PaymentTransaction" p WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(facts) f
  WHERE p.id=f->>'primaryPaymentTransactionId' AND p."vendorId"=f->>'vendorId'
 ) ORDER BY p."vendorId",p.id FOR SHARE OF p;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "CommerceOrder_metric_payment_lock" BEFORE INSERT OR UPDATE OR DELETE ON public."CommerceOrder"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_order_payment_lock();
REVOKE ALL ON FUNCTION public.wp20_metric_order_payment_lock() FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_order_payment_lock() FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
-- Previously issued proofs might have crossed the unsafe commit ordering.
UPDATE public."LiveMetricVersion" SET "sourceRevision"="sourceRevision"+1;
