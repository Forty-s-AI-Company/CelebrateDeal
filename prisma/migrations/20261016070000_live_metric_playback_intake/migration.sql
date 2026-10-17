BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- No backfill: earlier versions cannot certify pre-intake history.
ALTER TABLE public."LiveMetricVersion" ADD COLUMN "playbackIntakeStartedAt" TIMESTAMPTZ(3);
CREATE FUNCTION public.wp20_metric_playback_epoch() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  -- Serialize new protocol epochs with in-flight playback source decisions.
  PERFORM 1 FROM public."Live" WHERE id=NEW."liveId" AND "vendorId"=NEW."vendorId" FOR UPDATE;
  NEW."playbackIntakeStartedAt":=date_trunc('milliseconds',clock_timestamp());
 ELSIF NEW."playbackIntakeStartedAt" IS DISTINCT FROM OLD."playbackIntakeStartedAt" THEN
  RAISE EXCEPTION 'playback intake epoch is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricVersion_playback_epoch" BEFORE INSERT OR UPDATE ON public."LiveMetricVersion"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_playback_epoch();
CREATE TABLE public."LiveMetricPlaybackIntake" (
 id TEXT PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 "vendorId" TEXT NOT NULL,"liveId" TEXT NOT NULL,"versionId" TEXT NOT NULL,"admissionSessionId" TEXT NOT NULL,
 "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "lossAt" TIMESTAMPTZ(3),
 CONSTRAINT "LiveMetricPlaybackIntake_range_check" CHECK ("issuedAt"<"expiresAt"),
 CONSTRAINT "LiveMetricPlaybackIntake_scope_key" UNIQUE ("vendorId","liveId","versionId",id),
 CONSTRAINT "LiveMetricPlaybackIntake_version_fkey" FOREIGN KEY ("vendorId","liveId","versionId")
  REFERENCES public."LiveMetricVersion"("vendorId","liveId",id) ON DELETE CASCADE ON UPDATE NO ACTION
 -- No admission FK: release/deletion must not erase an unanswered expectation.
);
CREATE INDEX "LiveMetricPlaybackIntake_admission_idx" ON public."LiveMetricPlaybackIntake"("vendorId","liveId","admissionSessionId");
CREATE INDEX "LiveMetricPlaybackIntake_window_idx" ON public."LiveMetricPlaybackIntake"("vendorId","liveId","versionId","issuedAt");
CREATE FUNCTION public.wp20_metric_playback_intake_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off SET timezone='UTC' AS $$
DECLARE expiry TIMESTAMPTZ;
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public."LiveMetricVersion" WHERE id=OLD."versionId"
  AND "vendorId"=OLD."vendorId" AND "liveId"=OLD."liveId") THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND OLD."lossAt" IS NULL AND NEW."lossAt" IS NOT NULL
  AND (to_jsonb(NEW)-'lossAt') IS NOT DISTINCT FROM (to_jsonb(OLD)-'lossAt') THEN
  -- One permanent loss boundary bounds storage when a collector reaches quota.
  NEW."lossAt":=date_trunc('milliseconds',clock_timestamp()); RETURN NEW;
 END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'playback intake is immutable' USING ERRCODE='23514'; END IF;
 IF NEW."lossAt" IS NOT NULL THEN RAISE EXCEPTION 'new intake cannot forge loss time' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'playback intake requires read committed' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM public."Live" WHERE id=NEW."liveId" AND "vendorId"=NEW."vendorId" FOR SHARE;
 PERFORM 1 FROM public."LiveViewerSession" WHERE id=NEW."admissionSessionId" AND "liveId"=NEW."liveId" AND "vendorId"=NEW."vendorId" FOR NO KEY UPDATE;
 PERFORM 1 FROM public."LiveMetricVersion" WHERE id=NEW."versionId" AND "liveId"=NEW."liveId" AND "vendorId"=NEW."vendorId" FOR SHARE;
 NEW."issuedAt":=date_trunc('milliseconds',clock_timestamp());
 SELECT LEAST(v."expiresAt",a."expiresAt" AT TIME ZONE 'UTC') INTO expiry
 FROM public."LiveMetricVersion" v JOIN public."Live" l ON l.id=v."liveId" AND l."vendorId"=v."vendorId" AND l."videoId" IS NOT DISTINCT FROM v."videoId"
 JOIN public."LiveViewerSession" a ON a."vendorId"=v."vendorId" AND a."liveId"=v."liveId"
 WHERE v.id=NEW."versionId" AND v."vendorId"=NEW."vendorId" AND v."liveId"=NEW."liveId" AND a.id=NEW."admissionSessionId"
  AND v."collectionEnabled" AND v."collectionStartedAt"<=NEW."issuedAt";
 IF expiry IS NULL OR NEW."expiresAt">expiry OR NEW."expiresAt"<=NEW."issuedAt" THEN
  RAISE EXCEPTION 'playback intake scope or lifetime invalid' USING ERRCODE='23514';
 END IF;
 IF (SELECT count(*) FROM public."LiveMetricPlaybackIntake" WHERE "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId"
  AND "versionId"=NEW."versionId" AND "admissionSessionId"=NEW."admissionSessionId")>=64 THEN
  RAISE EXCEPTION 'playback intake limit reached' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricPlaybackIntake_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."LiveMetricPlaybackIntake"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_playback_intake_guard();
CREATE TRIGGER "LiveMetricPlaybackIntake_no_truncate" BEFORE TRUNCATE ON public."LiveMetricPlaybackIntake"
 FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();
ALTER TABLE public."LiveMetricSession" ADD COLUMN "intakeId" TEXT;
ALTER TABLE public."LiveMetricSession" ADD CONSTRAINT "LiveMetricSession_intake_fkey" FOREIGN KEY ("vendorId","liveId","versionId","intakeId")
 REFERENCES public."LiveMetricPlaybackIntake"("vendorId","liveId","versionId",id) ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE UNIQUE INDEX "LiveMetricSession_intake_key" ON public."LiveMetricSession"("vendorId","liveId","versionId","intakeId");
CREATE FUNCTION public.wp20_metric_session_intake_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW."intakeId" IS DISTINCT FROM OLD."intakeId" THEN RAISE EXCEPTION 'session intake binding is immutable' USING ERRCODE='23514'; END IF;
  IF NEW."intakeId" IS NOT NULL AND (NEW."anchorAt" IS DISTINCT FROM OLD."anchorAt"
   OR NEW."admissionSessionId" IS DISTINCT FROM OLD."admissionSessionId") THEN
   RAISE EXCEPTION 'session intake identity and anchor are immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 -- Revalidate every write, including a future renewal path. A session cannot
 -- outlive its committed intake merely because its binding id stays the same.
 IF NEW."intakeId" IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public."LiveMetricPlaybackIntake" i WHERE i.id=NEW."intakeId" AND i."vendorId"=NEW."vendorId"
    AND i."liveId"=NEW."liveId" AND i."versionId"=NEW."versionId" AND i."admissionSessionId"=NEW."admissionSessionId"
    AND NEW."anchorAt">=i."issuedAt" AND NEW."expiresAt"<=i."expiresAt") THEN
   RAISE EXCEPTION 'session intake scope or lifetime invalid' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricSession_intake_guard" BEFORE INSERT OR UPDATE ON public."LiveMetricSession"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_session_intake_guard();
CREATE FUNCTION public.wp20_metric_playback_intake_revision(vendor_id TEXT,live_id TEXT,version_id TEXT) RETURNS BIGINT
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $$
 SELECT count(*)+count("lossAt") FROM public."LiveMetricPlaybackIntake" WHERE "vendorId"=vendor_id AND "liveId"=live_id AND "versionId"=version_id
$$;
ALTER TABLE public."LiveMetricPlaybackIntake" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."LiveMetricPlaybackIntake" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wp20_metric_playback_epoch(),public.wp20_metric_playback_intake_guard(),public.wp20_metric_session_intake_guard(),public.wp20_metric_playback_intake_revision(text,text,text) FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON public."LiveMetricPlaybackIntake" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_playback_epoch(),public.wp20_metric_playback_intake_guard(),public.wp20_metric_session_intake_guard(),public.wp20_metric_playback_intake_revision(text,text,text) FROM %I',api_role);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
  WHERE c.oid='public."LiveMetricPlaybackIntake"'::regclass AND a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid
  CROSS JOIN LATERAL aclexplode(col.attacl) a
  WHERE c.oid='public."LiveMetricPlaybackIntake"'::regclass AND col.attnum>0 AND NOT col.attisdropped AND a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('wp20_metric_playback_epoch','wp20_metric_playback_intake_guard','wp20_metric_session_intake_guard','wp20_metric_playback_intake_revision') AND a.grantee<>p.proowner)
 THEN RAISE EXCEPTION 'unexpected playback intake privileges' USING ERRCODE='23514'; END IF;
END $$;
COMMIT;
