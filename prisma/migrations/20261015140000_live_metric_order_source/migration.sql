-- Append-only merchant/live change events avoid a shared payment-path update.
-- COUNT of immutable scoped events is the report input revision; sequence values
-- are never used as commit watermarks because transactions can commit out of order.
-- Do not update LiveMetricVersion or reports from Serializable payment writes.
CREATE TABLE public."LiveMetricOrderSource" (
 id BIGSERIAL PRIMARY KEY,
 "vendorId" TEXT NOT NULL REFERENCES public."Vendor"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "liveId" TEXT NOT NULL
);
CREATE INDEX "LiveMetricOrderSource_scope_idx" ON public."LiveMetricOrderSource" ("vendorId","liveId");

CREATE FUNCTION public.wp20_metric_order_source_changed() RETURNS trigger
-- Invoked only as a row trigger; no caller-supplied SQL or privileged output.
-- The commerce writer keeps its existing privileges; metric tables remain private.
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE candidates JSONB:='[]'::jsonb; fact JSONB; payment JSONB; scope RECORD;
BEGIN
 IF TG_LEVEL<>'ROW' OR TG_RELID NOT IN ('public."CommerceOrder"'::regclass,'public."PaymentTransaction"'::regclass) THEN
  RAISE EXCEPTION 'invalid metric source trigger relation' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='CommerceOrder' THEN
   IF
   (NEW."vendorId",NEW."primaryPaymentTransactionId",NEW."createdAt",NEW.status='draft',NEW.status='cancelled')
   IS NOT DISTINCT FROM
   (OLD."vendorId",OLD."primaryPaymentTransactionId",OLD."createdAt",OLD.status='draft',OLD.status='cancelled')
   THEN RETURN NULL; END IF;
  ELSE
   IF
   (NEW."vendorId",NEW.metadata->>'formSubmissionId',NEW.metadata->>'sourceLiveId',NEW.metadata->>'billingPurpose')
   IS NOT DISTINCT FROM
   (OLD."vendorId",OLD.metadata->>'formSubmissionId',OLD.metadata->>'sourceLiveId',OLD.metadata->>'billingPurpose')
   THEN RETURN NULL; END IF;
  END IF;
 END IF;
 -- Keep both old and new attribution. Payment changes invalidate their scopes
 -- even before an order exists, covering concurrent order creation.
 FOR fact IN SELECT value FROM jsonb_array_elements(
   (CASE WHEN TG_OP<>'INSERT' THEN jsonb_build_array(to_jsonb(OLD)) ELSE '[]'::jsonb END) ||
   (CASE WHEN TG_OP<>'DELETE' THEN jsonb_build_array(to_jsonb(NEW)) ELSE '[]'::jsonb END)) LOOP
  IF TG_TABLE_NAME='CommerceOrder' THEN
   IF fact->>'status'='draft' THEN CONTINUE; END IF;
   SELECT p.metadata INTO payment FROM public."PaymentTransaction" p
    WHERE p.id=fact->>'primaryPaymentTransactionId' AND p."vendorId"=fact->>'vendorId';
  ELSE payment:=fact->'metadata';
  END IF;
  IF payment->>'billingPurpose'='buyer_order' AND coalesce(payment->>'sourceLiveId','')<>''
     AND coalesce(payment->>'formSubmissionId','')<>'' THEN
   candidates:=candidates || jsonb_build_array(jsonb_build_object('vendorId',fact->>'vendorId','liveId',payment->>'sourceLiveId'));
  END IF;
 END LOOP;
 -- Stable old/new scope ordering. No customer metadata is persisted here.
 FOR scope IN SELECT DISTINCT value->>'vendorId' AS vendor_id,value->>'liveId' AS live_id
   FROM jsonb_array_elements(candidates) ORDER BY vendor_id,live_id LOOP
  INSERT INTO public."LiveMetricOrderSource" ("vendorId","liveId")
   SELECT "vendorId",id FROM public."Live" WHERE id=scope.live_id AND "vendorId"=scope.vendor_id;
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER "CommerceOrder_metric_source" AFTER INSERT OR UPDATE OR DELETE ON public."CommerceOrder"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_order_source_changed();
CREATE TRIGGER "PaymentTransaction_metric_source" AFTER INSERT OR UPDATE OR DELETE ON public."PaymentTransaction"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_order_source_changed();
ALTER TABLE public."LiveMetricOrderSource" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."LiveMetricOrderSource" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wp20_metric_order_source_changed() FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON TABLE public."LiveMetricOrderSource" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_order_source_changed() FROM %I',api_role);
  END IF;
 END LOOP;
END $$;

-- Removing events would allow an old COUNT revision to become current again.
CREATE FUNCTION public.wp20_metric_order_source_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public."Vendor" WHERE id=OLD."vendorId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'metric order events are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "LiveMetricOrderSource_immutable" BEFORE UPDATE OR DELETE ON public."LiveMetricOrderSource"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_order_source_immutable();
CREATE TRIGGER "LiveMetricOrderSource_no_truncate" BEFORE TRUNCATE ON public."LiveMetricOrderSource"
 FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();
REVOKE ALL ON FUNCTION public.wp20_metric_order_source_immutable() FROM PUBLIC;
REVOKE ALL ON SEQUENCE public."LiveMetricOrderSource_id_seq" FROM PUBLIC;

-- Private backend capability: callers still authorize vendor/live scope.
-- A caller-side RLS policy must never turn real events into a false zero count.
-- No table rows or customer fields leave this function. Explicit EXECUTE grants
-- belong only to trusted backend workers, never public/authenticated API roles.
CREATE FUNCTION public.wp20_metric_order_revision(vendor_id TEXT,live_id TEXT) RETURNS BIGINT
LANGUAGE sql STABLE STRICT SECURITY DEFINER
SET search_path=pg_catalog SET row_security=off AS $$
 SELECT count(*) FROM public."LiveMetricOrderSource" WHERE "vendorId"=vendor_id AND "liveId"=live_id
$$;
REVOKE ALL ON FUNCTION public.wp20_metric_order_revision(text,text) FROM PUBLIC;

-- Default privileges may grant named API roles independently of PUBLIC.
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON SEQUENCE public."LiveMetricOrderSource_id_seq" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_order_source_immutable() FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_order_revision(text,text) FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
