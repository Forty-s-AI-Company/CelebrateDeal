-- Coverage proofs bind both authoritative sources and materialized registrations.
-- Append events instead of updating a shared counter on the request path.
CREATE FUNCTION public.wp20_metric_registration_projection_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE fact RECORD;
BEGIN
 IF TG_OP='DELETE' THEN fact:=OLD; ELSE fact:=NEW; END IF;
 -- Parent removal discards its proofs too; never recreate events during a vendor cascade.
 IF EXISTS(SELECT 1 FROM public."Vendor" WHERE id=fact."vendorId")
  AND EXISTS(SELECT 1 FROM public."LiveMetricVersion" WHERE id=fact."versionId"
   AND "vendorId"=fact."vendorId" AND "liveId"=fact."liveId") THEN
  INSERT INTO public."LiveMetricRegistrationSource" ("vendorId","liveId") VALUES (fact."vendorId",fact."liveId");
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER "LiveMetricRegistration_source_revision" AFTER INSERT OR UPDATE OR DELETE ON public."LiveMetricRegistration"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_registration_projection_revision();
REVOKE ALL ON FUNCTION public.wp20_metric_registration_projection_revision() FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_registration_projection_revision() FROM %I',api_role);
  END IF;
 END LOOP;
END $$;

-- Statement-level deletion bypasses row revision triggers. Fail closed.
CREATE TRIGGER "LiveMetricRegistration_no_truncate" BEFORE TRUNCATE ON public."LiveMetricRegistration"
 FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();
