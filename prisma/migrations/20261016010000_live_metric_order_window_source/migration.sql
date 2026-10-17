-- Window-scoped append-only source, initially side-by-side with legacy fences.
-- Consumers must use a new proof format before switching; no legacy proof backfill.
CREATE TABLE public."LiveMetricOrderWindowSource" (
 id BIGSERIAL PRIMARY KEY,
 "vendorId" TEXT NOT NULL REFERENCES public."Vendor"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
 "orderCreatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "LiveMetricOrderWindowSource_scope_idx" ON public."LiveMetricOrderWindowSource"("vendorId","orderCreatedAt");
CREATE FUNCTION public.wp20_metric_order_window_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE facts JSONB;
BEGIN
 IF TG_LEVEL<>'ROW' OR TG_RELID NOT IN ('public."CommerceOrder"'::regclass,'public."PaymentTransaction"'::regclass) THEN
  RAISE EXCEPTION 'invalid order window source relation' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='CommerceOrder' THEN
   IF (NEW.id,NEW."vendorId",NEW."primaryPaymentTransactionId",NEW."createdAt",NEW.status)
    IS NOT DISTINCT FROM (OLD.id,OLD."vendorId",OLD."primaryPaymentTransactionId",OLD."createdAt",OLD.status) THEN RETURN NULL; END IF;
  ELSE
   IF (NEW.id,NEW."vendorId",NEW.metadata) IS NOT DISTINCT FROM (OLD.id,OLD."vendorId",OLD.metadata) THEN RETURN NULL; END IF;
  END IF;
 END IF;
 facts:=(CASE WHEN TG_OP<>'INSERT' THEN jsonb_build_array(to_jsonb(OLD)) ELSE '[]'::jsonb END)
  ||(CASE WHEN TG_OP<>'DELETE' THEN jsonb_build_array(to_jsonb(NEW)) ELSE '[]'::jsonb END);
 IF TG_TABLE_NAME='CommerceOrder' THEN
  INSERT INTO public."LiveMetricOrderWindowSource"("vendorId","orderCreatedAt")
   SELECT DISTINCT v.id,(f->>'createdAt')::timestamp(3)
   FROM jsonb_array_elements(facts) f JOIN public."Vendor" v ON v.id=f->>'vendorId'
   ORDER BY v.id,(f->>'createdAt')::timestamp(3);
 ELSE
  -- Payments without an established order have no window yet. The later order
  -- INSERT/link emits its own event even if payment metadata is missing.
  INSERT INTO public."LiveMetricOrderWindowSource"("vendorId","orderCreatedAt")
   SELECT DISTINCT o."vendorId",o."createdAt" FROM public."CommerceOrder" o
   JOIN jsonb_array_elements(facts) f ON o."primaryPaymentTransactionId"=f->>'id' AND o."vendorId"=f->>'vendorId'
   JOIN public."Vendor" v ON v.id=o."vendorId"
   ORDER BY o."vendorId",o."createdAt";
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER "CommerceOrder_metric_window_revision" AFTER INSERT OR UPDATE OR DELETE ON public."CommerceOrder"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_order_window_changed();
CREATE TRIGGER "PaymentTransaction_metric_window_revision" AFTER INSERT OR UPDATE OR DELETE ON public."PaymentTransaction"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_order_window_changed();
CREATE FUNCTION public.wp20_metric_order_window_revision(vendor_id TEXT,window_start TIMESTAMPTZ,window_end TIMESTAMPTZ) RETURNS BIGINT
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $$
 SELECT count(*) FROM public."LiveMetricOrderWindowSource" WHERE "vendorId"=vendor_id
  AND "orderCreatedAt">=(window_start AT TIME ZONE 'UTC') AND "orderCreatedAt"<(window_end AT TIME ZONE 'UTC')
$$;
CREATE TRIGGER "LiveMetricOrderWindowSource_immutable" BEFORE UPDATE OR DELETE ON public."LiveMetricOrderWindowSource"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_order_source_immutable();
CREATE TRIGGER "LiveMetricOrderWindowSource_no_truncate" BEFORE TRUNCATE ON public."LiveMetricOrderWindowSource"
 FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();
ALTER TABLE public."LiveMetricOrderWindowSource" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."LiveMetricOrderWindowSource" FROM PUBLIC;
REVOKE ALL ON SEQUENCE public."LiveMetricOrderWindowSource_id_seq" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wp20_metric_order_window_changed(),public.wp20_metric_order_window_revision(text,timestamptz,timestamptz) FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON TABLE public."LiveMetricOrderWindowSource" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON SEQUENCE public."LiveMetricOrderWindowSource_id_seq" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_order_window_changed(),public.wp20_metric_order_window_revision(text,timestamptz,timestamptz) FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
