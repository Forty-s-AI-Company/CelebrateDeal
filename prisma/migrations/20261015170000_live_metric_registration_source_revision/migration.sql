-- Insert-only authoritative submission ledger: no shared version-row UPDATE.
-- COUNT in a snapshot is the revision; max(sequence) is not a commit watermark.
CREATE TABLE public."LiveMetricRegistrationSource" (
 id BIGSERIAL PRIMARY KEY,
 "vendorId" TEXT NOT NULL REFERENCES public."Vendor"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
 "liveId" TEXT NOT NULL
);
CREATE INDEX "LiveMetricRegistrationSource_scope_idx" ON public."LiveMetricRegistrationSource"("vendorId","liveId");
CREATE FUNCTION public.wp20_metric_registration_source_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE old_live TEXT; new_live TEXT; scope RECORD;
BEGIN
 IF TG_LEVEL<>'ROW' OR TG_RELID<>'public."FormSubmission"'::regclass THEN
  RAISE EXCEPTION 'invalid registration source relation' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND
  (NEW.id,NEW."liveId",NEW."formId",NEW."verificationStatus",NEW."verifiedAt") IS NOT DISTINCT FROM
  (OLD.id,OLD."liveId",OLD."formId",OLD."verificationStatus",OLD."verifiedAt") THEN RETURN NULL; END IF;
 IF TG_OP<>'INSERT' AND OLD."verificationStatus"='VERIFIED' THEN old_live:=OLD."liveId"; END IF;
 IF TG_OP<>'DELETE' AND NEW."verificationStatus"='VERIFIED' THEN new_live:=NEW."liveId"; END IF;
 FOR scope IN SELECT l.id,l."vendorId" FROM public."Live" l
  WHERE l.id=old_live OR l.id=new_live ORDER BY l.id LOOP
  INSERT INTO public."LiveMetricRegistrationSource"("vendorId","liveId") VALUES(scope."vendorId",scope.id);
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER "FormSubmission_metric_audit_revision" AFTER INSERT OR UPDATE OR DELETE ON public."FormSubmission"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_registration_source_revision();
CREATE FUNCTION public.wp20_metric_registration_source_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public."Vendor" WHERE id=OLD."vendorId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'metric registration source events are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "LiveMetricRegistrationSource_immutable" BEFORE UPDATE OR DELETE ON public."LiveMetricRegistrationSource"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_registration_source_immutable();
CREATE TRIGGER "LiveMetricRegistrationSource_no_truncate" BEFORE TRUNCATE ON public."LiveMetricRegistrationSource"
 FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();
CREATE FUNCTION public.wp20_metric_registration_revision(vendor_id TEXT,live_id TEXT) RETURNS BIGINT
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $$
 SELECT count(*) FROM public."LiveMetricRegistrationSource" WHERE "vendorId"=vendor_id AND "liveId"=live_id
$$;
ALTER TABLE public."LiveMetricRegistrationSource" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."LiveMetricRegistrationSource" FROM PUBLIC;
REVOKE ALL ON SEQUENCE public."LiveMetricRegistrationSource_id_seq" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wp20_metric_registration_source_revision(),public.wp20_metric_registration_source_immutable(),public.wp20_metric_registration_revision(text,text) FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON public."LiveMetricRegistrationSource" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON SEQUENCE public."LiveMetricRegistrationSource_id_seq" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_registration_source_revision(),public.wp20_metric_registration_source_immutable(),public.wp20_metric_registration_revision(text,text) FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
