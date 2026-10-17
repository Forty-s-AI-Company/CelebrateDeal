-- Fence the complete tenant order inventory, including unattributed sources.
-- Append-only events avoid a shared counter lock in payment transactions.
CREATE TABLE public."LiveMetricOrderTenantSource" (
 id BIGSERIAL PRIMARY KEY,
 "vendorId" TEXT NOT NULL REFERENCES public."Vendor"(id) ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "LiveMetricOrderTenantSource_vendor_idx" ON public."LiveMetricOrderTenantSource"("vendorId");
CREATE FUNCTION public.wp20_metric_order_tenant_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_vendor TEXT; new_vendor TEXT; target TEXT;
BEGIN
 IF TG_LEVEL<>'ROW' OR TG_RELID NOT IN ('public."CommerceOrder"'::regclass,'public."PaymentTransaction"'::regclass) THEN
  RAISE EXCEPTION 'invalid tenant order source relation' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='CommerceOrder' THEN
   IF (NEW."vendorId",NEW."primaryPaymentTransactionId",NEW."createdAt",NEW.status)
    IS NOT DISTINCT FROM (OLD."vendorId",OLD."primaryPaymentTransactionId",OLD."createdAt",OLD.status) THEN RETURN NULL; END IF;
  ELSE
   IF (NEW."vendorId",NEW.metadata) IS NOT DISTINCT FROM (OLD."vendorId",OLD.metadata) THEN RETURN NULL; END IF;
  END IF;
 END IF;
 IF TG_OP<>'INSERT' THEN old_vendor:=OLD."vendorId"; END IF;
 IF TG_OP<>'DELETE' THEN new_vendor:=NEW."vendorId"; END IF;
 FOR target IN SELECT DISTINCT value FROM unnest(ARRAY[old_vendor,new_vendor]) value WHERE value IS NOT NULL ORDER BY value LOOP
  INSERT INTO public."LiveMetricOrderTenantSource"("vendorId") SELECT id FROM public."Vendor" WHERE id=target;
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER "CommerceOrder_metric_tenant_revision" AFTER INSERT OR UPDATE OR DELETE ON public."CommerceOrder"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_order_tenant_changed();
CREATE TRIGGER "PaymentTransaction_metric_tenant_revision" AFTER INSERT OR UPDATE OR DELETE ON public."PaymentTransaction"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_order_tenant_changed();
CREATE FUNCTION public.wp20_metric_order_tenant_revision(vendor_id TEXT) RETURNS BIGINT
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $$
 SELECT count(*) FROM public."LiveMetricOrderTenantSource" WHERE "vendorId"=vendor_id
$$;
CREATE TRIGGER "LiveMetricOrderTenantSource_immutable" BEFORE UPDATE OR DELETE ON public."LiveMetricOrderTenantSource"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_order_source_immutable();
CREATE TRIGGER "LiveMetricOrderTenantSource_no_truncate" BEFORE TRUNCATE ON public."LiveMetricOrderTenantSource"
 FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();
CREATE TRIGGER "CommerceOrder_metric_no_truncate" BEFORE TRUNCATE ON public."CommerceOrder"
 FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();
CREATE TRIGGER "PaymentTransaction_metric_no_truncate" BEFORE TRUNCATE ON public."PaymentTransaction"
 FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();
ALTER TABLE public."LiveMetricOrderTenantSource" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."LiveMetricOrderTenantSource" FROM PUBLIC;
REVOKE ALL ON SEQUENCE public."LiveMetricOrderTenantSource_id_seq" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wp20_metric_order_tenant_changed(),public.wp20_metric_order_tenant_revision(text) FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON TABLE public."LiveMetricOrderTenantSource" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON SEQUENCE public."LiveMetricOrderTenantSource_id_seq" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_order_tenant_changed(),public.wp20_metric_order_tenant_revision(text) FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
