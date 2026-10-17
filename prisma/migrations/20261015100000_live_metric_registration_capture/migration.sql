-- No historical backfill: current devices cannot establish original attribution.
CREATE TABLE public."LiveMetricRegistrationCapture" (
 "submissionId" TEXT PRIMARY KEY, "vendorId" TEXT NOT NULL, "liveId" TEXT NOT NULL,
 "versionId" TEXT NOT NULL, "visitorId" TEXT,
 "capturedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 CONSTRAINT "LiveMetricRegistrationCapture_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES public."FormSubmission"(id) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT "LiveMetricRegistrationCapture_vendorId_liveId_versionId_fkey" FOREIGN KEY ("vendorId","liveId","versionId") REFERENCES public."LiveMetricVersion"("vendorId","liveId",id) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT "LiveMetricRegistrationCapture_visitor_fkey" FOREIGN KEY ("vendorId","liveId","versionId","visitorId") REFERENCES public."LiveMetricVisitor"("vendorId","liveId","versionId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "LiveMetricRegistrationCapture_scope_submission_idx" ON public."LiveMetricRegistrationCapture"("vendorId","liveId","versionId","submissionId");
CREATE INDEX "LiveMetricRegistrationCapture_scope_visitor_idx" ON public."LiveMetricRegistrationCapture"("vendorId","liveId","versionId","visitorId");
CREATE FUNCTION public.wp20_metric_capture_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public SET timezone='UTC' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  RAISE EXCEPTION 'metric initial capture is immutable' USING ERRCODE='23514';
 ELSIF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM public."LiveMetricVersion" WHERE id=OLD."versionId")
   AND EXISTS(SELECT 1 FROM public."FormSubmission" WHERE id=OLD."submissionId") THEN
   RAISE EXCEPTION 'metric initial capture requires parent deletion' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
 END IF;
 PERFORM 1 FROM public."LiveMetricVersion" WHERE id=NEW."versionId" AND "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'metric capture scope unavailable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."LiveMetricVersion" WHERE id=NEW."versionId" AND "collectionEnabled" AND "collectionStartedAt"<=clock_timestamp() AND "expiresAt">clock_timestamp()) THEN
  RAISE EXCEPTION 'metric capture collection unavailable' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM public."FormSubmission" s
 JOIN public."RegistrationForm" f ON f.id=s."formId" AND f."vendorId"=NEW."vendorId"
 JOIN public."Live" l ON l.id=s."liveId" AND l."vendorId"=NEW."vendorId" AND l."formId"=s."formId"
 WHERE s.id=NEW."submissionId" AND s."liveId"=NEW."liveId" AND s."verificationStatus"='UNVERIFIED' FOR SHARE OF s;
 IF NOT FOUND THEN RAISE EXCEPTION 'metric capture initial submission unavailable' USING ERRCODE='23514'; END IF;
 NEW."capturedAt" := date_trunc('milliseconds',clock_timestamp());
 RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricRegistrationCapture_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."LiveMetricRegistrationCapture" FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_capture_guard();
CREATE FUNCTION public.wp20_metric_capture_no_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public SET timezone='UTC' AS $$
BEGIN RAISE EXCEPTION 'metric capture truncate prohibited' USING ERRCODE='23514'; END $$;
CREATE TRIGGER "LiveMetricRegistrationCapture_no_truncate" BEFORE TRUNCATE ON public."LiveMetricRegistrationCapture" FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_capture_no_truncate();
ALTER TABLE public."LiveMetricRegistrationCapture" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."LiveMetricRegistrationCapture" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wp20_metric_capture_guard(),public.wp20_metric_capture_no_truncate() FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON TABLE public."LiveMetricRegistrationCapture" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_capture_guard(),public.wp20_metric_capture_no_truncate() FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
