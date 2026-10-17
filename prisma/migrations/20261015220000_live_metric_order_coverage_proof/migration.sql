-- Order completeness must bind every source fence, including unattributed orders.
-- Legacy rows stay nullable and are ignored by the positive-coverage reader.
ALTER TABLE public."LiveMetricCoverageAudit"
 ADD COLUMN "orderRevision" BIGINT CHECK ("orderRevision">=0),
 ADD COLUMN "orderTenantRevision" BIGINT CHECK ("orderTenantRevision">=0),
 ADD COLUMN "orderRegistrationRevision" BIGINT CHECK ("orderRegistrationRevision">=0),
 ADD COLUMN "orderCount" INTEGER CHECK ("orderCount">=0);
CREATE FUNCTION public.wp20_metric_order_coverage_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW."orderRevision" IS NOT NULL OR NEW."orderTenantRevision" IS NOT NULL
  OR NEW."orderRegistrationRevision" IS NOT NULL OR NEW."orderCount" IS NOT NULL THEN
  IF NEW.kind<>'orders' OR NEW.status<>'covered' OR NEW."orderCount" IS NULL
   OR NEW."orderRevision" IS NULL OR NEW."orderTenantRevision" IS NULL OR NEW."orderRegistrationRevision" IS NULL
   OR NEW."orderRevision" IS DISTINCT FROM public.wp20_metric_order_revision(NEW."vendorId",NEW."liveId")
   OR NEW."orderTenantRevision" IS DISTINCT FROM public.wp20_metric_order_tenant_revision(NEW."vendorId")
   OR NEW."orderRegistrationRevision" IS DISTINCT FROM public.wp20_metric_registration_revision(NEW."vendorId",NEW."liveId") THEN
   RAISE EXCEPTION 'order coverage source mismatch' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricCoverageAudit_order_guard" BEFORE INSERT ON public."LiveMetricCoverageAudit"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_order_coverage_guard();
REVOKE ALL ON FUNCTION public.wp20_metric_order_coverage_guard() FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_order_coverage_guard() FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
