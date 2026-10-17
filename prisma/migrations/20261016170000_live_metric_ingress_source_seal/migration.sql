BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Private source frontier only: no epoch/universe/completeness assertion.
CREATE TABLE public."LiveMetricIngressSeal" (
 "runId" TEXT PRIMARY KEY,"vendorId" TEXT NOT NULL,"liveId" TEXT NOT NULL,"versionId" TEXT NOT NULL,
 "sealedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 "frameCount" INTEGER NOT NULL DEFAULT 0 CHECK ("frameCount" BETWEEN 0 AND 10000),
 "pageCount" INTEGER NOT NULL DEFAULT 0 CHECK ("pageCount" BETWEEN 0 AND 10000),
 "playbackCount" INTEGER NOT NULL DEFAULT 0 CHECK ("playbackCount" BETWEEN 0 AND 10000),
 UNIQUE ("vendorId","liveId","versionId","runId"),
 FOREIGN KEY ("vendorId","liveId","versionId","runId") REFERENCES public."LiveMetricIngressRun"("vendorId","liveId","versionId",id) ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE FUNCTION public.wp20_metric_ingress_seal_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off SET timezone='UTC' AS $$
DECLARE parent public."LiveMetricIngressRun";
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM public."LiveMetricIngressRun" WHERE id=OLD."runId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'metric source seal is retained' USING ERRCODE='23514';
 END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'metric source seal is immutable' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' OR pg_is_in_recovery()
  OR NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND shobj_description(oid,'pg_database') ~ '^prisma-no-dotenv:[a-f0-9]{16}$') THEN
  RAISE EXCEPTION 'metric source seal requires owned primary read committed' USING ERRCODE='23514';
 END IF;
 -- Same parent order as source predicate: version SHARE -> run. Its run SHARE
 -- lives until source commit. UPDATE drains those writers before the recount.
 PERFORM 1 FROM public."LiveMetricVersion" WHERE id=NEW."versionId" AND "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'metric source seal scope unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM public."LiveMetricIngressRun" WHERE id=NEW."runId" AND "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" AND "versionId"=NEW."versionId" FOR UPDATE;
 IF NOT FOUND OR parent."stoppedAt" IS NULL THEN RAISE EXCEPTION 'metric source seal requires stopped run' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public."LiveMetricIngressFrame" WHERE "runId"=NEW."runId" AND outcome='pending') THEN
  RAISE EXCEPTION 'metric source seal requires settled frames' USING ERRCODE='23514';
 END IF;
 -- Source/frontier counters are derived, never supplied by an operator.
 SELECT count(*) INTO NEW."frameCount" FROM public."LiveMetricIngressFrame" WHERE "runId"=NEW."runId";
 SELECT count(*) INTO NEW."pageCount" FROM public."LiveMetricVisitPage" p JOIN public."LiveMetricIngressFrame" f ON f.id=p."ingressFrameId" WHERE f."runId"=NEW."runId";
 SELECT count(*) INTO NEW."playbackCount" FROM public."LiveMetricPlaybackIntake" p JOIN public."LiveMetricIngressFrame" f ON f.id=p."ingressFrameId" WHERE f."runId"=NEW."runId";
 NEW."sealedAt":=date_trunc('milliseconds',clock_timestamp());
 IF NEW."sealedAt"<parent."stoppedAt" THEN RAISE EXCEPTION 'metric source seal clock unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricIngressSeal_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."LiveMetricIngressSeal" FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_ingress_seal_guard();
CREATE TRIGGER "LiveMetricIngressSeal_no_truncate" BEFORE TRUNCATE ON public."LiveMetricIngressSeal" FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_ingress_seal_guard();
ALTER TABLE public."LiveMetricIngressSeal" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."LiveMetricIngressSeal" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wp20_metric_ingress_seal_guard() FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.wp20_metric_ingress_source_allowed(vendor_key TEXT,live_key TEXT,version_key TEXT,frame_key TEXT,source_kind TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off AS $$
DECLARE source_run TEXT; route TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR pg_is_in_recovery() THEN
  RAISE EXCEPTION 'metric ingress source requires primary read committed' USING ERRCODE='23514';
 END IF;
 -- Caller already owns canonical Live/admission/Video/version locks. This
 -- function is private; it never grants browser or source coverage authority.
 PERFORM 1 FROM public."LiveMetricVersion" WHERE id=version_key AND "vendorId"=vendor_key AND "liveId"=live_key FOR SHARE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 SELECT id INTO source_run FROM public."LiveMetricIngressRun" WHERE "versionId"=version_key AND "vendorId"=vendor_key AND "liveId"=live_key FOR SHARE;
 IF NOT FOUND THEN RETURN frame_key IS NULL; END IF;
 -- The run SHARE lock serializes against seal's run UPDATE. A late writer
 -- observes the committed immutable frontier under a fresh RC snapshot.
 IF EXISTS(SELECT 1 FROM public."LiveMetricIngressSeal" WHERE "runId"=source_run) THEN RETURN FALSE; END IF;
 -- Serialize consumers, then inspect used sources under a fresh RC snapshot.
 -- The shared precheck + BEFORE INSERT predicate closes the retry race without
 -- allowing duplicate source rows or converting a unique violation to success.
 SELECT "routeKind" INTO route FROM public."LiveMetricIngressFrame" WHERE id=frame_key AND "runId"=source_run AND "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key FOR UPDATE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 IF EXISTS(SELECT 1 FROM public."LiveMetricVisitPage" WHERE "ingressFrameId"=frame_key)
  OR EXISTS(SELECT 1 FROM public."LiveMetricPlaybackIntake" WHERE "ingressFrameId"=frame_key) THEN RETURN FALSE; END IF;
 RETURN coalesce((source_kind='playback' AND route='playback') OR (source_kind='registration' AND route IN ('form','landing','landing_step')) OR (source_kind='viewer' AND route='viewer'),FALSE);
END $$;
-- Existing run admissionLimit and its guard cap each run at <=10000 frames.
REVOKE ALL ON FUNCTION public.wp20_metric_ingress_source_allowed(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_ingress_source_allowed(TEXT,TEXT,TEXT,TEXT,TEXT) FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON TABLE public."LiveMetricIngressSeal" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_ingress_seal_guard() FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
-- Migration125 still rejects unsupported covered visits/viewing. A source seal
-- never closes visit intents, sessions, playback receipts or request universe.
COMMIT;
