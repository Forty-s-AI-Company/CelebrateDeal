BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Expectations for browser-started logical visits only. No historical backfill,
-- epoch or positive coverage: server-rendered pages that never start JS remain
-- outside this protocol and cannot be called a complete page-visit universe.
CREATE TABLE public."LiveMetricVisitIntent" (
 "vendorId" TEXT NOT NULL,"liveId" TEXT NOT NULL,"versionId" TEXT NOT NULL,
 "visitorId" TEXT NOT NULL,"eventId" TEXT NOT NULL,
 "preparedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 CONSTRAINT "LiveMetricVisitIntent_pkey" PRIMARY KEY ("vendorId","liveId","versionId","eventId"),
 CONSTRAINT "LiveMetricVisitIntent_event_check" CHECK ("eventId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 CONSTRAINT "LiveMetricVisitIntent_version_fkey" FOREIGN KEY ("vendorId","liveId","versionId")
  REFERENCES public."LiveMetricVersion"("vendorId","liveId",id) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT "LiveMetricVisitIntent_visitor_fkey" FOREIGN KEY ("vendorId","liveId","versionId","visitorId")
  REFERENCES public."LiveMetricVisitor"("vendorId","liveId","versionId",id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE INDEX "LiveMetricVisitIntent_window_idx" ON public."LiveMetricVisitIntent"("vendorId","liveId","versionId","preparedAt","eventId");
CREATE INDEX "LiveMetricVisitIntent_visitor_idx" ON public."LiveMetricVisitIntent"("vendorId","liveId","versionId","visitorId");
CREATE FUNCTION public.wp20_metric_visit_intent_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off SET timezone='UTC' AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public."LiveMetricVersion" WHERE id=OLD."versionId"
  AND "vendorId"=OLD."vendorId" AND "liveId"=OLD."liveId") THEN RETURN OLD; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'visit intent is immutable' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'visit intent requires read committed' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM public."LiveMetricVersion" WHERE id=NEW."versionId" AND "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" FOR SHARE;
 PERFORM 1 FROM public."LiveMetricVisitor" WHERE id=NEW."visitorId" AND "vendorId"=NEW."vendorId"
  AND "liveId"=NEW."liveId" AND "versionId"=NEW."versionId" FOR NO KEY UPDATE;
 NEW."preparedAt":=date_trunc('milliseconds',clock_timestamp());
 IF NOT EXISTS(SELECT 1 FROM public."LiveMetricVersion" v JOIN public."LiveMetricVisitor" b
  ON b."vendorId"=v."vendorId" AND b."liveId"=v."liveId" AND b."versionId"=v.id
  WHERE v.id=NEW."versionId" AND v."vendorId"=NEW."vendorId" AND v."liveId"=NEW."liveId" AND b.id=NEW."visitorId"
   AND v."collectionEnabled" AND v."collectionStartedAt"<=NEW."preparedAt" AND NEW."preparedAt"<v."expiresAt"
   AND b."firstVisitedAt"<=NEW."preparedAt") THEN
  RAISE EXCEPTION 'visit intent scope or lifetime invalid' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricVisitIntent_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."LiveMetricVisitIntent"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_visit_intent_guard();
CREATE TRIGGER "LiveMetricVisitIntent_no_truncate" BEFORE TRUNCATE ON public."LiveMetricVisitIntent"
 FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();
ALTER TABLE public."LiveMetricVisitIntent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."LiveMetricVisitIntent" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wp20_metric_visit_intent_guard() FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON public."LiveMetricVisitIntent" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_visit_intent_guard() FROM %I',api_role);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
  WHERE c.oid='public."LiveMetricVisitIntent"'::regclass AND a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid CROSS JOIN LATERAL aclexplode(col.attacl) a
  WHERE c.oid='public."LiveMetricVisitIntent"'::regclass AND col.attnum>0 AND NOT col.attisdropped AND a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public.wp20_metric_visit_intent_guard()'::regprocedure AND a.grantee<>p.proowner)
 THEN RAISE EXCEPTION 'unexpected visit intent privileges' USING ERRCODE='23514'; END IF;
END $$;
COMMIT;
