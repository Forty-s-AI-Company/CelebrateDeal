BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Render expectations are NOT counted visits. No backfill or coverage epoch.
CREATE TABLE public."LiveMetricVisitPage" (
 "vendorId" TEXT NOT NULL,"liveId" TEXT NOT NULL,"versionId" TEXT NOT NULL,"eventId" TEXT NOT NULL,
 "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "lossAt" TIMESTAMPTZ(3),
 CONSTRAINT "LiveMetricVisitPage_pkey" PRIMARY KEY ("vendorId","liveId","versionId","eventId"),
 CONSTRAINT "LiveMetricVisitPage_event_check" CHECK ("eventId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 CONSTRAINT "LiveMetricVisitPage_time_check" CHECK ("issuedAt"<"expiresAt"),
 CONSTRAINT "LiveMetricVisitPage_version_fkey" FOREIGN KEY ("vendorId","liveId","versionId")
  REFERENCES public."LiveMetricVersion"("vendorId","liveId",id) ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "LiveMetricVisitPage_window_idx" ON public."LiveMetricVisitPage"("vendorId","liveId","versionId","issuedAt","eventId");
CREATE FUNCTION public.wp20_metric_visit_page_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off SET timezone='UTC' AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public."LiveMetricVersion" WHERE id=OLD."versionId"
  AND "vendorId"=OLD."vendorId" AND "liveId"=OLD."liveId") THEN RETURN OLD; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'visit page expectation requires read committed' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD."lossAt" IS NULL AND NEW."lossAt" IS NOT NULL
  AND (to_jsonb(NEW)-'lossAt') IS NOT DISTINCT FROM (to_jsonb(OLD)-'lossAt') THEN
  NEW."lossAt":=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
 END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'visit page expectation is immutable' USING ERRCODE='23514'; END IF;
 IF NEW."lossAt" IS NOT NULL THEN RAISE EXCEPTION 'new page cannot forge loss time' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array('wp20_metric_visit_page',NEW."vendorId",NEW."liveId")::text,0));
 PERFORM 1 FROM public."LiveMetricVersion" WHERE id=NEW."versionId" AND "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" FOR SHARE;
 NEW."issuedAt":=date_trunc('milliseconds',clock_timestamp());
 IF NOT EXISTS(SELECT 1 FROM public."LiveMetricVersion" WHERE id=NEW."versionId" AND "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId"
  AND "collectionEnabled" AND "collectionStartedAt"<=NEW."issuedAt" AND NEW."expiresAt"<="expiresAt" AND NEW."expiresAt">NEW."issuedAt") THEN
  RAISE EXCEPTION 'visit page scope or lifetime invalid' USING ERRCODE='P2090';
 END IF;
 -- Matches MAX_METRIC_VISIT_PAGES. A full version retains its first permanent
 -- loss marker through the issuer rather than deleting unacknowledged rows.
 IF (SELECT count(*) FROM public."LiveMetricVisitPage" WHERE "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" AND "versionId"=NEW."versionId")>=10000 THEN
  RAISE EXCEPTION 'visit page quota reached' USING ERRCODE='P2091';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricVisitPage_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."LiveMetricVisitPage"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_visit_page_guard();
CREATE TRIGGER "LiveMetricVisitPage_no_truncate" BEFORE TRUNCATE ON public."LiveMetricVisitPage"
 FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();
ALTER TABLE public."LiveMetricVisitPage" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."LiveMetricVisitPage" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wp20_metric_visit_page_guard() FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON public."LiveMetricVisitPage" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_visit_page_guard() FROM %I',api_role);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
  WHERE c.oid='public."LiveMetricVisitPage"'::regclass AND a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid CROSS JOIN LATERAL aclexplode(col.attacl) a
  WHERE c.oid='public."LiveMetricVisitPage"'::regclass AND col.attnum>0 AND NOT col.attisdropped AND a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public.wp20_metric_visit_page_guard()'::regprocedure AND a.grantee<>p.proowner)
 THEN RAISE EXCEPTION 'unexpected visit page privileges' USING ERRCODE='23514'; END IF;
END $$;
COMMIT;
