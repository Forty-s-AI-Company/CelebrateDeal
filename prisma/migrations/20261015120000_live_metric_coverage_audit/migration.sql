-- Storage for independent collector audits. No backfill and no automatic
-- certification from collectionEnabled, row counts or successful requests.
CREATE TABLE public."LiveMetricCoverageAudit" (
 id TEXT PRIMARY KEY,
 "vendorId" TEXT NOT NULL, "liveId" TEXT NOT NULL, "versionId" TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('visits','registrations','viewing','orders')),
 status TEXT NOT NULL CHECK (status IN ('covered','gap')),
 "startAt" TIMESTAMPTZ(3) NOT NULL, "endAt" TIMESTAMPTZ(3) NOT NULL,
 "sourceRevision" BIGINT NOT NULL CHECK ("sourceRevision">=0),
 "auditDigest" CHAR(64) NOT NULL CHECK ("auditDigest" ~ '^[0-9a-f]{64}$'),
 "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 CONSTRAINT "LiveMetricCoverageAudit_range_check" CHECK ("startAt"<"endAt"),
 CONSTRAINT "LiveMetricCoverageAudit_version_fkey" FOREIGN KEY ("vendorId","liveId","versionId")
 REFERENCES public."LiveMetricVersion"("vendorId","liveId",id) ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "LiveMetricCoverageAudit_scope_range_idx" ON public."LiveMetricCoverageAudit"("vendorId","liveId","versionId",kind,"startAt","endAt");
CREATE FUNCTION public.wp20_metric_coverage_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE v public."LiveMetricVersion"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM public."LiveMetricVersion" WHERE id=OLD."versionId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'metric coverage audit requires parent deletion' USING ERRCODE='23514';
 ELSIF TG_OP='UPDATE' THEN
  RAISE EXCEPTION 'metric coverage audit is immutable' USING ERRCODE='23514';
 END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'metric coverage writes require read committed isolation' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v FROM public."LiveMetricVersion" WHERE id=NEW."versionId"
  AND "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'metric coverage scope unavailable' USING ERRCODE='23514'; END IF;
 NEW."recordedAt":=date_trunc('milliseconds',clock_timestamp());
 IF NEW."sourceRevision"<>v."sourceRevision" OR NEW."endAt">NEW."recordedAt"
  OR NEW."endAt">v."expiresAt" THEN
  RAISE EXCEPTION 'metric coverage revision or range unavailable' USING ERRCODE='23514';
 END IF;
 -- This is a necessary boundary, not proof of uninterrupted collection.
 IF NEW.status='covered' AND (v."collectionStartedAt" IS NULL OR NEW."startAt"<v."collectionStartedAt") THEN
  RAISE EXCEPTION 'metric coverage cannot certify pre-collection history' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.wp20_metric_coverage_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public SET timezone='UTC' AS $$
BEGIN
 UPDATE public."LiveMetricReport" SET status='stale',result=NULL,"leaseOwner"=NULL,"leaseExpiresAt"=NULL
 WHERE "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" AND "versionId"=NEW."versionId"
  AND "windowStartAt"<NEW."endAt" AND "windowEndAt">NEW."startAt" AND status<>'stale';
 RETURN NULL;
END $$;
CREATE TRIGGER "LiveMetricCoverageAudit_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."LiveMetricCoverageAudit"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_coverage_guard();
CREATE TRIGGER "LiveMetricCoverageAudit_changed" AFTER INSERT ON public."LiveMetricCoverageAudit"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_coverage_changed();
CREATE TRIGGER "LiveMetricCoverageAudit_no_truncate" BEFORE TRUNCATE ON public."LiveMetricCoverageAudit"
 FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();
ALTER TABLE public."LiveMetricCoverageAudit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."LiveMetricCoverageAudit" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wp20_metric_coverage_guard(),public.wp20_metric_coverage_changed() FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON TABLE public."LiveMetricCoverageAudit" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_coverage_guard(),public.wp20_metric_coverage_changed() FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
