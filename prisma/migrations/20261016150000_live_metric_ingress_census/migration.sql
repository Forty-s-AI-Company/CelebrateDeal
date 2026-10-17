BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Inactive foundation: no application entry point enables a run. Creation is
-- additionally restricted to our marked disposable DB. Never certify coverage
-- from these rows: producer bindings, source fences and epoch proof still follow.
CREATE TABLE public."LiveMetricIngressRun" (
 id TEXT PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),"vendorId" TEXT NOT NULL,"liveId" TEXT NOT NULL,"versionId" TEXT NOT NULL UNIQUE,
 "manifestHash" CHAR(64) NOT NULL CHECK ("manifestHash" ~ '^[a-f0-9]{64}$'),
 "admissionLimit" INTEGER NOT NULL CHECK ("admissionLimit" BETWEEN 1 AND 10000),
 "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 "stoppedAt" TIMESTAMPTZ(3),
 UNIQUE ("vendorId","liveId","versionId"),
 UNIQUE ("vendorId","liveId","versionId",id),
 FOREIGN KEY ("vendorId","liveId","versionId") REFERENCES public."LiveMetricVersion"("vendorId","liveId",id) ON DELETE CASCADE ON UPDATE NO ACTION,
 CHECK ("stoppedAt" IS NULL OR "stoppedAt">="openedAt")
);
CREATE TABLE public."LiveMetricIngressFrame" (
 id TEXT PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),"vendorId" TEXT NOT NULL,"liveId" TEXT NOT NULL,"versionId" TEXT NOT NULL,"runId" TEXT NOT NULL,
 "routeKind" TEXT NOT NULL CHECK ("routeKind" IN ('form','landing','landing_step','viewer','playback')),
 "admittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 outcome TEXT NOT NULL DEFAULT 'pending',"settledAt" TIMESTAMPTZ(3),"httpStatus" INTEGER,
 FOREIGN KEY ("vendorId","liveId","versionId","runId") REFERENCES public."LiveMetricIngressRun"("vendorId","liveId","versionId",id) ON DELETE CASCADE ON UPDATE NO ACTION,
 CHECK ((outcome='pending' AND "settledAt" IS NULL AND "httpStatus" IS NULL)
  OR (outcome='responded' AND "settledAt" IS NOT NULL AND "settledAt">="admittedAt" AND "httpStatus" IS NOT NULL AND "httpStatus" BETWEEN 200 AND 599)
  OR (outcome='interrupted' AND "settledAt" IS NOT NULL AND "settledAt">="admittedAt" AND "httpStatus" IS NULL))
);
CREATE INDEX "LiveMetricIngressFrame_runId_admittedAt_id_idx" ON public."LiveMetricIngressFrame"("runId","admittedAt",id);
CREATE FUNCTION public.wp20_metric_ingress_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off SET timezone='UTC' AS $$
DECLARE parent public."LiveMetricIngressRun"; lifetime TIMESTAMPTZ;
BEGIN
 -- Only the canonical parent cascade may remove evidence. Direct DELETE and
 -- TRUNCATE are forbidden; stop retains unanswered/aborted requests forever.
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME='LiveMetricIngressRun' THEN
   IF NOT EXISTS(SELECT 1 FROM public."LiveMetricVersion" WHERE id=OLD."versionId" AND "vendorId"=OLD."vendorId" AND "liveId"=OLD."liveId") THEN RETURN OLD; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM public."LiveMetricIngressRun" WHERE id=OLD."runId") THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'metric ingress evidence is retained' USING ERRCODE='23514';
 END IF;
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'metric ingress evidence is retained' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' OR pg_is_in_recovery() THEN
  RAISE EXCEPTION 'metric ingress requires primary read committed' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='LiveMetricIngressRun' THEN
  IF TG_OP='INSERT' THEN
   IF NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND shobj_description(oid,'pg_database') ~ '^prisma-no-dotenv:[a-f0-9]{16}$') THEN
    RAISE EXCEPTION 'metric ingress requires owned disposable database' USING ERRCODE='23514';
   END IF;
   -- Lock the version before checking history, matching existing source writers.
   SELECT "expiresAt" INTO lifetime FROM public."LiveMetricVersion"
    WHERE id=NEW."versionId" AND "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" AND "collectionEnabled" FOR UPDATE;
   IF NOT FOUND OR lifetime<=clock_timestamp() THEN RAISE EXCEPTION 'metric ingress scope unavailable' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM public."LiveMetricVisitPage" WHERE "versionId"=NEW."versionId")
    OR EXISTS(SELECT 1 FROM public."LiveMetricPlaybackIntake" WHERE "versionId"=NEW."versionId")
    OR EXISTS(SELECT 1 FROM public."LiveMetricVisitor" WHERE "versionId"=NEW."versionId")
    OR EXISTS(SELECT 1 FROM public."LiveMetricRegistration" WHERE "versionId"=NEW."versionId")
    OR EXISTS(SELECT 1 FROM public."LiveMetricSession" WHERE "versionId"=NEW."versionId") THEN
    RAISE EXCEPTION 'metric ingress cannot backfill source history' USING ERRCODE='23514';
   END IF;
   NEW."openedAt":=date_trunc('milliseconds',clock_timestamp());NEW."stoppedAt":=NULL;
   RETURN NEW;
  END IF;
  IF OLD."stoppedAt" IS NULL AND NEW."stoppedAt" IS NOT NULL AND
   (to_jsonb(NEW)-'stoppedAt') IS NOT DISTINCT FROM (to_jsonb(OLD)-'stoppedAt') THEN
   NEW."stoppedAt":=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
  END IF;
  RAISE EXCEPTION 'metric ingress run is immutable except stop' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
  -- Parent before child also avoids a cascade-delete/admission lock inversion.
  SELECT "expiresAt" INTO lifetime FROM public."LiveMetricVersion"
   WHERE id=NEW."versionId" AND "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" AND "collectionEnabled" FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'metric ingress scope unavailable' USING ERRCODE='23514'; END IF;
  -- Serialize capacity and stop on one run row. Read-committed recount occurs
  -- AFTER this lock, so concurrent last-slot requests cannot both be admitted.
  SELECT * INTO parent FROM public."LiveMetricIngressRun" WHERE id=NEW."runId" AND "vendorId"=NEW."vendorId"
   AND "liveId"=NEW."liveId" AND "versionId"=NEW."versionId" FOR UPDATE;
  IF NOT FOUND OR parent."stoppedAt" IS NOT NULL THEN RAISE EXCEPTION 'metric ingress admission closed' USING ERRCODE='23514'; END IF;
  IF lifetime<=clock_timestamp() OR (SELECT count(*) FROM public."LiveMetricIngressFrame" WHERE "runId"=NEW."runId")>=parent."admissionLimit" THEN
   RAISE EXCEPTION 'metric ingress admission exhausted' USING ERRCODE='23514';
  END IF;
  NEW."admittedAt":=date_trunc('milliseconds',clock_timestamp());NEW.outcome:='pending';NEW."settledAt":=NULL;NEW."httpStatus":=NULL;
  RETURN NEW;
 END IF;
 IF OLD.outcome='pending' AND NEW.outcome IN ('responded','interrupted') AND
  (to_jsonb(NEW)-ARRAY['outcome','settledAt','httpStatus']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['outcome','settledAt','httpStatus']) THEN
  NEW."settledAt":=date_trunc('milliseconds',clock_timestamp());RETURN NEW;
 END IF;
 RAISE EXCEPTION 'metric ingress frame is immutable except settlement' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "LiveMetricIngressRun_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."LiveMetricIngressRun" FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_ingress_guard();
CREATE TRIGGER "LiveMetricIngressRun_no_truncate" BEFORE TRUNCATE ON public."LiveMetricIngressRun" FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_ingress_guard();
CREATE TRIGGER "LiveMetricIngressFrame_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."LiveMetricIngressFrame" FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_ingress_guard();
CREATE TRIGGER "LiveMetricIngressFrame_no_truncate" BEFORE TRUNCATE ON public."LiveMetricIngressFrame" FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_ingress_guard();
ALTER TABLE public."LiveMetricIngressRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LiveMetricIngressFrame" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."LiveMetricIngressRun",public."LiveMetricIngressFrame" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wp20_metric_ingress_guard() FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON TABLE public."LiveMetricIngressRun",public."LiveMetricIngressFrame" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_ingress_guard() FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
-- 125 remains intact: neither a stopped run nor a response receipt proves
-- browser collection, playback delivery, source closure or metric coverage.
COMMIT;
