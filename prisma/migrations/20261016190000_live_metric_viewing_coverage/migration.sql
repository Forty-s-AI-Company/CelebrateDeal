BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public."LiveMetricCoverageAudit" ADD COLUMN "viewingRevision" BIGINT,ADD COLUMN "intakeRevision" BIGINT,
 ADD CONSTRAINT "LiveMetricCoverageAudit_viewing_proof_revisions" CHECK
 (NOT (kind='viewing' AND "ingressProofVersion" IS NOT DISTINCT FROM 2)
  OR ("viewingRevision" IS NOT NULL AND "viewingRevision">=0 AND "intakeRevision" IS NOT NULL AND "intakeRevision">=0
   AND "registrationRevision" IS NOT NULL AND "registrationRevision">=0));
-- Reuse the existing version SHARE -> run SHARE frontier, including UPDATE.
CREATE OR REPLACE FUNCTION public.wp20_metric_ingress_visit_frontier() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off AS $$
DECLARE vendor_key TEXT; live_key TEXT; version_key TEXT; run_key TEXT;
BEGIN
 IF TG_OP='UPDATE' AND (NEW."vendorId",NEW."liveId",NEW."versionId") IS DISTINCT FROM (OLD."vendorId",OLD."liveId",OLD."versionId") THEN
  RAISE EXCEPTION 'metric source scope is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN
  vendor_key:=OLD."vendorId";live_key:=OLD."liveId";version_key:=OLD."versionId";
  IF NOT EXISTS(SELECT 1 FROM public."LiveMetricVersion" WHERE id=version_key AND "vendorId"=vendor_key AND "liveId"=live_key) THEN RETURN OLD; END IF;
  -- A registration/form erasure can reach sessions before the sibling version
  -- cascade. Only the ACTUAL missing FK parent permits that child deletion;
  -- arbitrary nested triggers with a present parent still cannot erase facts.
  IF TG_RELID='public."LiveMetricSession"'::regclass THEN
   IF NOT EXISTS(SELECT 1 FROM public."LiveMetricRegistration" WHERE id=OLD."registrationId"
    AND "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key) THEN RETURN OLD; END IF;
  ELSIF TG_RELID='public."LiveMetricInterval"'::regclass THEN
   IF NOT EXISTS(SELECT 1 FROM public."LiveMetricSession" WHERE id=OLD."sessionId"
    AND "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key) THEN RETURN OLD; END IF;
  END IF;
 ELSE vendor_key:=NEW."vendorId";live_key:=NEW."liveId";version_key:=NEW."versionId"; END IF;
 IF current_setting('transaction_isolation')<>'read committed' OR pg_is_in_recovery() THEN
  RAISE EXCEPTION 'metric visit frontier requires primary read committed' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM public."LiveMetricVersion" WHERE id=version_key AND "vendorId"=vendor_key AND "liveId"=live_key FOR SHARE;
 SELECT id INTO run_key FROM public."LiveMetricIngressRun" WHERE "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key FOR SHARE;
 IF FOUND AND EXISTS(SELECT 1 FROM public."LiveMetricIngressSeal" WHERE "runId"=run_key) THEN
  RAISE EXCEPTION 'metric visit source frontier sealed' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER "LiveMetricSession_viewing_frontier" BEFORE INSERT OR UPDATE OR DELETE ON public."LiveMetricSession"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_ingress_visit_frontier();
CREATE TRIGGER "LiveMetricInterval_viewing_frontier" BEFORE INSERT OR UPDATE OR DELETE ON public."LiveMetricInterval"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_ingress_visit_frontier();
CREATE TRIGGER "LiveMetricPlaybackIntake_viewing_frontier" BEFORE INSERT OR UPDATE OR DELETE ON public."LiveMetricPlaybackIntake"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_ingress_visit_frontier();

-- The only terminal intake state is its linked closed, complete session.
-- An unused lease may remain unexpired for retries; it never reopens that
-- session. Eligibility uses stored seal/session times, never wall-clock TTL.
CREATE FUNCTION public.wp20_metric_viewing_proof_ready(vendor_key TEXT,live_key TEXT,version_key TEXT,run_key TEXT,
 start_at TIMESTAMPTZ,end_at TIMESTAMPTZ,receipt JSONB,viewing_revision BIGINT,intake_revision BIGINT,registration_revision BIGINT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off SET timezone='UTC' AS $$
DECLARE r public."LiveMetricIngressRun"; seal public."LiveMetricIngressSeal"; v public."LiveMetricVersion"; provenance RECORD;
 intake_count BIGINT; session_count BIGINT; interval_count BIGINT; frame_count BIGINT;
BEGIN
 IF viewing_revision IS NULL OR intake_revision IS NULL OR registration_revision IS NULL OR start_at IS NULL OR end_at IS NULL
  OR pg_is_in_recovery() OR NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database()
   AND shobj_description(oid,'pg_database') ~ '^prisma-no-dotenv:[a-f0-9]{16}$') THEN RETURN FALSE; END IF;
 SELECT * INTO r FROM public."LiveMetricIngressRun" WHERE id=run_key AND "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key;
 IF NOT FOUND OR r."stoppedAt" IS NULL THEN RETURN FALSE; END IF;
 SELECT * INTO seal FROM public."LiveMetricIngressSeal" WHERE "runId"=run_key AND "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key;
 IF NOT FOUND OR start_at IS DISTINCT FROM r."openedAt" OR end_at IS DISTINCT FROM seal."sealedAt" THEN RETURN FALSE; END IF;
 IF jsonb_typeof(receipt) IS DISTINCT FROM 'object' OR (receipt @> '{"format":1,"settlementFailures":0,"admissionFailures":0,"pendingFrames":0}'::jsonb) IS NOT TRUE
  OR receipt->>'runId' IS DISTINCT FROM run_key OR receipt->>'manifestHash' IS DISTINCT FROM r."manifestHash"
  OR coalesce(receipt->>'gatewayId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR receipt->>'frameDigest' IS DISTINCT FROM public.wp20_metric_ingress_frame_digest(vendor_key,live_key,version_key,run_key)
  OR receipt->>'closedAt' IS NULL THEN RETURN FALSE; END IF;
 BEGIN
  IF (receipt->>'closedAt')::timestamptz<r."stoppedAt" OR (receipt->>'closedAt')::timestamptz>seal."sealedAt" THEN RETURN FALSE; END IF;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN FALSE; END;
 SELECT * INTO v FROM public."LiveMetricVersion" WHERE id=version_key AND "vendorId"=vendor_key AND "liveId"=live_key;
 IF NOT FOUND OR NOT v."collectionEnabled" OR v."collectionStartedAt" IS NULL OR v."collectionStartedAt">start_at
  OR v."playbackIntakeStartedAt" IS NULL OR v."playbackIntakeStartedAt">start_at OR v."expiresAt"<end_at THEN RETURN FALSE; END IF;
 SELECT * INTO provenance FROM public.wp20_metric_viewing_provenance(vendor_key,live_key,version_key,start_at,end_at);
 IF NOT FOUND OR provenance."epochStartedAt" IS NULL OR provenance."epochStartedAt">start_at
  OR provenance."viewingRevision" IS DISTINCT FROM viewing_revision OR provenance."removedCount" IS DISTINCT FROM 0::bigint
  OR public.wp20_metric_playback_intake_revision(vendor_key,live_key,version_key) IS DISTINCT FROM intake_revision
  OR public.wp20_metric_registration_revision(vendor_key,live_key) IS DISTINCT FROM registration_revision THEN RETURN FALSE; END IF;
 SELECT count(*) INTO intake_count FROM (SELECT 1 FROM public."LiveMetricPlaybackIntake" WHERE "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key LIMIT 10001) q;
 SELECT count(*) INTO session_count FROM (SELECT 1 FROM public."LiveMetricSession" WHERE "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key LIMIT 10001) q;
 SELECT count(*) INTO interval_count FROM (SELECT 1 FROM public."LiveMetricInterval" WHERE "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key LIMIT 1000001) q;
 SELECT count(*) INTO frame_count FROM public."LiveMetricIngressFrame" WHERE "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key AND "runId"=run_key;
 IF intake_count>10000 OR session_count>10000 OR intake_count+session_count+interval_count>1000000
  OR frame_count IS DISTINCT FROM seal."frameCount" OR intake_count IS DISTINCT FROM seal."playbackCount"
  OR provenance."issuedCount" IS DISTINCT FROM session_count OR intake_count IS DISTINCT FROM session_count THEN RETURN FALSE; END IF;
 -- Every issued URL has exactly one bound source and a terminal session.
 IF EXISTS(SELECT 1 FROM public."LiveMetricIngressFrame" f LEFT JOIN public."LiveMetricPlaybackIntake" p
  ON p."vendorId"=f."vendorId" AND p."liveId"=f."liveId" AND p."versionId"=f."versionId" AND p."ingressFrameId"=f.id
  WHERE f."vendorId"=vendor_key AND f."liveId"=live_key AND f."versionId"=version_key AND f."runId"=run_key
   AND (f.outcome='pending' OR (f."routeKind"='playback' AND (f.outcome IS DISTINCT FROM 'responded' OR f."httpStatus" IS DISTINCT FROM 200 OR p.id IS NULL)))) THEN RETURN FALSE; END IF;
 IF EXISTS(SELECT 1 FROM public."LiveMetricPlaybackIntake" p LEFT JOIN public."LiveMetricIngressFrame" f
  ON f.id=p."ingressFrameId" AND f."vendorId"=p."vendorId" AND f."liveId"=p."liveId" AND f."versionId"=p."versionId" AND f."runId"=run_key
  LEFT JOIN public."LiveMetricSession" s ON s."intakeId"=p.id AND s."vendorId"=p."vendorId" AND s."liveId"=p."liveId" AND s."versionId"=p."versionId"
  WHERE p."vendorId"=vendor_key AND p."liveId"=live_key AND p."versionId"=version_key AND
   (f.id IS NULL OR f."routeKind" IS DISTINCT FROM 'playback' OR p."lossAt" IS NOT NULL OR p."issuedAt"<f."admittedAt" OR p."issuedAt">end_at
    OR s.id IS NULL OR s."admissionSessionId" IS DISTINCT FROM p."admissionSessionId" OR s."closedAt" IS NULL OR s.complete IS NOT TRUE
    OR s."anchorAt"<p."issuedAt" OR s."expiresAt">p."expiresAt" OR s."closedAt">end_at)) THEN RETURN FALSE; END IF;
 -- Recheck canonical registration identity and complete contiguous delivery.
 IF EXISTS(
  WITH ordered AS MATERIALIZED (
   SELECT i.*,lag(i."wallEndAt") OVER(PARTITION BY i."sessionId" ORDER BY i.sequence) AS previous_end
   FROM public."LiveMetricInterval" i WHERE i."vendorId"=vendor_key AND i."liveId"=live_key AND i."versionId"=version_key
  ), intervals AS MATERIALIZED (
   SELECT "sessionId",count(*) AS n,min(sequence) AS first_sequence,max(sequence) AS last_sequence,max("wallEndAt") AS last_end,min("wallStartAt") AS first_start,
    bool_and("wallEndAt">"wallStartAt" AND (previous_end IS NULL OR "wallStartAt">=previous_end)
      AND "mediaStartMs">=0 AND "mediaEndMs">"mediaStartMs" AND (v."durationMs" IS NULL OR "mediaEndMs"<=v."durationMs")) AS valid
   FROM ordered GROUP BY "sessionId"
  )
  SELECT 1 FROM public."LiveMetricSession" s LEFT JOIN public."LiveMetricRegistration" g ON g.id=s."registrationId"
   AND g."vendorId"=s."vendorId" AND g."liveId"=s."liveId" AND g."versionId"=s."versionId"
  LEFT JOIN public."Live" l ON l.id=s."liveId" AND l."vendorId"=s."vendorId"
  LEFT JOIN public."FormSubmission" f ON f.id=g."submissionId" LEFT JOIN public."RegistrationForm" form ON form.id=f."formId"
  LEFT JOIN public."LiveMetricPlaybackIntake" p ON p.id=s."intakeId" AND p."vendorId"=s."vendorId" AND p."liveId"=s."liveId" AND p."versionId"=s."versionId"
  LEFT JOIN intervals i ON i."sessionId"=s.id
  WHERE s."vendorId"=vendor_key AND s."liveId"=live_key AND s."versionId"=version_key AND
   (g.id IS NULL OR g."verifiedAt"<start_at OR g."verifiedAt">=end_at
    OR (f."verificationStatus"='VERIFIED' AND f."verifiedAt"=(g."verifiedAt" AT TIME ZONE 'UTC')
     AND f."liveId"=g."liveId" AND f."formId"=l."formId" AND form."vendorId"=g."vendorId") IS NOT TRUE
    OR p.id IS NULL OR s."anchorAt"<start_at OR s."anchorAt">=end_at OR s."closedAt" IS NULL OR s.complete IS NOT TRUE
    OR s."closedAt">end_at OR s."closedAt">s."expiresAt" OR s."finalSequence" IS DISTINCT FROM s."lastSequence"
    OR coalesce(i.n,0) IS DISTINCT FROM (s."lastSequence"+1)::bigint
    OR (coalesce(i.n,0)>0 AND (i.first_sequence IS DISTINCT FROM 0 OR i.last_sequence IS DISTINCT FROM s."lastSequence" OR i.valid IS NOT TRUE))
    OR extract(epoch FROM (coalesce(i.last_end,s."anchorAt")-s."anchorAt"))*1000 IS DISTINCT FROM s."lastElapsedMs"::numeric
    OR (coalesce(i.n,0)>0 AND (i.first_start IS NULL OR i.first_start<s."anchorAt"))
    OR coalesce(i.last_end,s."anchorAt")>s."closedAt")) THEN RETURN FALSE; END IF;
 RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION public.wp20_metric_registration_coverage_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 -- Viewing binds the same immutable identity ledger, but it is not a
 -- registration coverage claim. Its own typed guard independently checks all
 -- terminal viewing sources. The original registration branch remains below.
 IF NEW.kind='viewing' AND NEW.status='covered' AND NEW."ingressProofVersion"=2 AND NEW."registrationRevision" IS NOT NULL THEN
  IF NEW."registrationRevision" IS DISTINCT FROM public.wp20_metric_registration_revision(NEW."vendorId",NEW."liveId") THEN
   RAISE EXCEPTION 'registration coverage source mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW."registrationRevision" IS NOT NULL THEN
  IF NEW.kind<>'registrations' OR NEW.status<>'covered' OR NEW."registrationCount" IS NULL
   OR NEW."registrationRevision" IS DISTINCT FROM public.wp20_metric_registration_revision(NEW."vendorId",NEW."liveId") THEN
   RAISE EXCEPTION 'registration coverage source mismatch' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.wp20_metric_unproven_coverage_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.status='covered' AND NEW.kind='viewing' AND (NEW."ingressProofVersion" IS DISTINCT FROM 2 OR NEW."ingressRunId" IS NULL OR NEW."ingressReceipt" IS NULL
  OR public.wp20_metric_viewing_proof_ready(NEW."vendorId",NEW."liveId",NEW."versionId",NEW."ingressRunId",NEW."startAt",NEW."endAt",NEW."ingressReceipt",
   NEW."viewingRevision",NEW."intakeRevision",NEW."registrationRevision") IS NOT TRUE) THEN
  RAISE EXCEPTION 'metric coverage requires trusted source proof' USING ERRCODE='23514'; END IF;
 IF NEW.status='covered' AND NEW.kind='visits' AND (NEW."ingressProofVersion" IS DISTINCT FROM 1 OR NEW."ingressRunId" IS NULL OR NEW."ingressReceipt" IS NULL
  OR NOT public.wp20_metric_visits_proof_ready(NEW."vendorId",NEW."liveId",NEW."versionId",NEW."ingressRunId",NEW."startAt",NEW."endAt",NEW."ingressReceipt")) THEN
  RAISE EXCEPTION 'metric coverage requires trusted source proof' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.wp20_metric_viewing_proof_ready(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,JSONB,BIGINT,BIGINT,BIGINT) FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_viewing_proof_ready(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,JSONB,BIGINT,BIGINT,BIGINT) FROM %I',api_role);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public.wp20_metric_viewing_proof_ready(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,JSONB,BIGINT,BIGINT,BIGINT)'::regprocedure AND a.grantee<>p.proowner) THEN
  RAISE EXCEPTION 'unexpected viewing proof privileges' USING ERRCODE='23514'; END IF;
END $$;
COMMIT;
