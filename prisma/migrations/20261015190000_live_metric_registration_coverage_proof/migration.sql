-- Legacy positive registration audits lack this provenance and are not trusted.
ALTER TABLE public."LiveMetricCoverageAudit"
 ADD COLUMN "registrationRevision" BIGINT CHECK ("registrationRevision">=0),
 ADD COLUMN "registrationCount" INTEGER CHECK ("registrationCount">=0);
CREATE FUNCTION public.wp20_metric_registration_coverage_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW."registrationRevision" IS NOT NULL THEN
  IF NEW.kind<>'registrations' OR NEW.status<>'covered' OR NEW."registrationCount" IS NULL
   OR NEW."registrationRevision" IS DISTINCT FROM public.wp20_metric_registration_revision(NEW."vendorId",NEW."liveId") THEN
   RAISE EXCEPTION 'registration coverage source mismatch' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricCoverageAudit_registration_guard" BEFORE INSERT ON public."LiveMetricCoverageAudit"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_registration_coverage_guard();
REVOKE ALL ON FUNCTION public.wp20_metric_registration_coverage_guard() FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_registration_coverage_guard() FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
