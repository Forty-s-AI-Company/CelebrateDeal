BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public."LiveMetricPlaybackIntake" ADD COLUMN "renewalCount" BIGINT NOT NULL DEFAULT 0 CHECK ("renewalCount">=0);
CREATE OR REPLACE FUNCTION public.wp20_metric_playback_intake_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off SET timezone='UTC' AS $$
DECLARE expiry TIMESTAMPTZ; decision_at TIMESTAMPTZ;
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public."LiveMetricVersion" WHERE id=OLD."versionId"
  AND "vendorId"=OLD."vendorId" AND "liveId"=OLD."liveId") THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND NEW."expiresAt">OLD."expiresAt"
  AND NEW."renewalCount"=OLD."renewalCount"
  AND (to_jsonb(NEW)-'expiresAt') IS NOT DISTINCT FROM (to_jsonb(OLD)-'expiresAt') THEN
  -- The row lock serializes extensions. Source locks match normal issuance.
  PERFORM 1 FROM public."Live" WHERE id=OLD."liveId" AND "vendorId"=OLD."vendorId" FOR SHARE;
  PERFORM 1 FROM public."LiveViewerSession" WHERE id=OLD."admissionSessionId" AND "liveId"=OLD."liveId" AND "vendorId"=OLD."vendorId" FOR NO KEY UPDATE;
  PERFORM 1 FROM public."LiveMetricVersion" WHERE id=OLD."versionId" AND "liveId"=OLD."liveId" AND "vendorId"=OLD."vendorId" FOR SHARE;
  -- Normal callers already hold this session before the intake row. Direct
  -- writes must also serialize against close/expiry changes, never resurrect.
  PERFORM 1 FROM public."LiveMetricSession" s WHERE s."intakeId"=OLD.id
   AND s."vendorId"=OLD."vendorId" AND s."liveId"=OLD."liveId" AND s."versionId"=OLD."versionId"
   AND s."admissionSessionId"=OLD."admissionSessionId" FOR NO KEY UPDATE;
  decision_at:=date_trunc('milliseconds',clock_timestamp());
  SELECT LEAST(v."expiresAt",a."expiresAt" AT TIME ZONE 'UTC') INTO expiry
   FROM public."LiveMetricVersion" v JOIN public."Live" l ON l.id=v."liveId" AND l."vendorId"=v."vendorId" AND l."videoId" IS NOT DISTINCT FROM v."videoId"
   JOIN public."LiveViewerSession" a ON a."liveId"=v."liveId" AND a."vendorId"=v."vendorId"
   WHERE v.id=OLD."versionId" AND v."vendorId"=OLD."vendorId" AND v."liveId"=OLD."liveId"
    AND a.id=OLD."admissionSessionId" AND v."collectionEnabled" AND v."collectionStartedAt"<=decision_at;
  IF current_setting('transaction_isolation')<>'read committed' OR expiry IS NULL
    OR OLD."expiresAt"<=decision_at OR NEW."expiresAt">expiry
    OR NOT EXISTS(SELECT 1 FROM public."LiveMetricSession" s WHERE s."intakeId"=OLD.id
      AND s."vendorId"=OLD."vendorId" AND s."liveId"=OLD."liveId" AND s."versionId"=OLD."versionId"
      AND s."admissionSessionId"=OLD."admissionSessionId" AND s."closedAt" IS NULL AND s."expiresAt">decision_at) THEN
   RAISE EXCEPTION 'playback intake renewal scope or lifetime invalid' USING ERRCODE='23514';
  END IF;
  NEW."renewalCount":=OLD."renewalCount"+1;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD."lossAt" IS NULL AND NEW."lossAt" IS NOT NULL
  AND (to_jsonb(NEW)-'lossAt') IS NOT DISTINCT FROM (to_jsonb(OLD)-'lossAt') THEN
  -- One permanent loss boundary bounds storage when a collector reaches quota.
  NEW."lossAt":=date_trunc('milliseconds',clock_timestamp()); RETURN NEW;
 END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'playback intake is immutable' USING ERRCODE='23514'; END IF;
 IF NEW."renewalCount"<>0 THEN RAISE EXCEPTION 'new intake cannot forge renewal count' USING ERRCODE='23514'; END IF;
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
CREATE OR REPLACE FUNCTION public.wp20_metric_session_intake_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off SET timezone='UTC' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD."intakeId" IS NOT NULL AND NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
   AND (NEW."expiresAt"<OLD."expiresAt" OR OLD."closedAt" IS NOT NULL OR OLD."expiresAt"<=clock_timestamp()) THEN
   RAISE EXCEPTION 'bound session renewal requires an open unexpired monotonic lease' USING ERRCODE='23514';
  END IF;
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
CREATE OR REPLACE FUNCTION public.wp20_metric_playback_intake_revision(vendor_id TEXT,live_id TEXT,version_id TEXT) RETURNS BIGINT
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $$
 SELECT (count(*)+count("lossAt")+coalesce(sum("renewalCount"),0))::bigint
 FROM public."LiveMetricPlaybackIntake" WHERE "vendorId"=vendor_id AND "liveId"=live_id AND "versionId"=version_id
$$;
COMMIT;
