BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Fixed owned synthetic ingress only. This is not a production collection epoch.
ALTER TABLE public."LiveMetricCoverageAudit"
 ADD COLUMN "ingressRunId" TEXT, ADD COLUMN "ingressProofVersion" INTEGER, ADD COLUMN "ingressReceipt" JSONB,
 ADD CONSTRAINT "LiveMetricCoverageAudit_ingressRun_fkey" FOREIGN KEY ("vendorId","liveId","versionId","ingressRunId")
 REFERENCES public."LiveMetricIngressRun"("vendorId","liveId","versionId",id) ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE FUNCTION public.wp20_metric_ingress_frame_digest(vendor_key TEXT,live_key TEXT,version_key TEXT,run_key TEXT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off AS $$
 SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(f.id,f."routeKind",
  extract(epoch FROM f."admittedAt")*1000,f.outcome,extract(epoch FROM f."settledAt")*1000,f."httpStatus") ORDER BY f.id),'[]'::jsonb)::text,'UTF8')),'hex')
 FROM public."LiveMetricIngressFrame" f WHERE f."vendorId"=vendor_key AND f."liveId"=live_key AND f."versionId"=version_key AND f."runId"=run_key
$$;

-- Seal already drains version SHARE -> run SHARE writers before run UPDATE.
-- Extend that frontier to visit acknowledgements; no direct deletion may erase
-- a sealed denominator. Parent-version cascade remains the only exception.
CREATE FUNCTION public.wp20_metric_ingress_visit_frontier() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off AS $$
DECLARE vendor_key TEXT; live_key TEXT; version_key TEXT; run_key TEXT;
BEGIN
 IF TG_OP='DELETE' THEN
  vendor_key:=OLD."vendorId";live_key:=OLD."liveId";version_key:=OLD."versionId";
  IF NOT EXISTS(SELECT 1 FROM public."LiveMetricVersion" WHERE id=version_key AND "vendorId"=vendor_key AND "liveId"=live_key) THEN RETURN OLD; END IF;
 ELSE vendor_key:=NEW."vendorId";live_key:=NEW."liveId";version_key:=NEW."versionId"; END IF;
 IF current_setting('transaction_isolation')<>'read committed' OR pg_is_in_recovery() THEN
  RAISE EXCEPTION 'metric visit frontier requires primary read committed' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM public."LiveMetricVersion" WHERE id=version_key AND "vendorId"=vendor_key AND "liveId"=live_key FOR SHARE;
 SELECT id INTO run_key FROM public."LiveMetricIngressRun" WHERE "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key FOR SHARE;
 IF FOUND AND EXISTS(SELECT 1 FROM public."LiveMetricIngressSeal" WHERE "runId"=run_key) THEN
  RAISE EXCEPTION 'metric visit source frontier sealed' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER "LiveMetricVisit_ingress_frontier" BEFORE INSERT OR DELETE ON public."LiveMetricVisit"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_ingress_visit_frontier();
CREATE TRIGGER "LiveMetricVisitIntent_ingress_frontier" BEFORE INSERT OR DELETE ON public."LiveMetricVisitIntent"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_ingress_visit_frontier();

-- Same function validates publication and same-snapshot consumption. Receipt
-- insertion is owner-only: existing audit RLS/ACLs grant no application INSERT.
-- The gateway, not a caller boolean, mints the receipt in the private publisher.
CREATE FUNCTION public.wp20_metric_visits_proof_ready(vendor_key TEXT,live_key TEXT,version_key TEXT,run_key TEXT,
 start_at TIMESTAMPTZ,end_at TIMESTAMPTZ,receipt JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off SET timezone='UTC' AS $$
DECLARE r public."LiveMetricIngressRun"; s public."LiveMetricIngressSeal";
 page_count BIGINT; intent_count BIGINT; fact_count BIGINT; frame_count BIGINT; intake_count BIGINT;
BEGIN
 IF pg_is_in_recovery() OR NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database()
  AND shobj_description(oid,'pg_database') ~ '^prisma-no-dotenv:[a-f0-9]{16}$') THEN RETURN FALSE; END IF;
 SELECT * INTO r FROM public."LiveMetricIngressRun" WHERE id=run_key AND "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key;
 IF NOT FOUND OR r."stoppedAt" IS NULL THEN RETURN FALSE; END IF;
 SELECT * INTO s FROM public."LiveMetricIngressSeal" WHERE "runId"=run_key AND "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key;
 IF NOT FOUND OR start_at<>r."openedAt" OR end_at<>s."sealedAt" OR end_at>transaction_timestamp() THEN RETURN FALSE; END IF;
 IF jsonb_typeof(receipt)<>'object' OR NOT (receipt @> '{"format":1,"settlementFailures":0,"admissionFailures":0,"pendingFrames":0}'::jsonb)
  OR receipt->>'runId' IS DISTINCT FROM run_key OR receipt->>'manifestHash' IS DISTINCT FROM r."manifestHash"
  OR coalesce(receipt->>'gatewayId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR receipt->>'frameDigest' IS DISTINCT FROM public.wp20_metric_ingress_frame_digest(vendor_key,live_key,version_key,run_key)
  OR receipt->>'closedAt' IS NULL THEN RETURN FALSE; END IF;
 BEGIN
  IF (receipt->>'closedAt')::timestamptz<r."stoppedAt" OR (receipt->>'closedAt')::timestamptz>s."sealedAt" THEN RETURN FALSE; END IF;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN FALSE; END;
 IF NOT EXISTS(SELECT 1 FROM public."LiveMetricVersion" WHERE id=version_key AND "vendorId"=vendor_key AND "liveId"=live_key
  AND "collectionEnabled" AND "collectionStartedAt"<=r."openedAt" AND "expiresAt">s."sealedAt") THEN RETURN FALSE; END IF;
 -- Probe a complete bounded set, never evaluate a prefix as a complete source.
 SELECT count(*) INTO page_count FROM (SELECT 1 FROM public."LiveMetricVisitPage" WHERE "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key LIMIT 10001) q;
 SELECT count(*) INTO intent_count FROM (SELECT 1 FROM public."LiveMetricVisitIntent" WHERE "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key LIMIT 10001) q;
 SELECT count(*) INTO fact_count FROM (SELECT 1 FROM public."LiveMetricVisit" WHERE "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key LIMIT 10001) q;
 SELECT count(*) INTO frame_count FROM public."LiveMetricIngressFrame" WHERE "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key AND "runId"=run_key;
 SELECT count(*) INTO intake_count FROM (SELECT 1 FROM public."LiveMetricPlaybackIntake" WHERE "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key LIMIT 10001) q;
 IF greatest(page_count,intent_count,fact_count,frame_count,intake_count)>10000 OR frame_count<>s."frameCount"
  OR page_count<>s."pageCount" OR intake_count<>s."playbackCount" THEN RETURN FALSE; END IF;
 IF EXISTS(SELECT 1 FROM public."LiveMetricIngressFrame" f LEFT JOIN public."LiveMetricVisitPage" p
  ON p."vendorId"=f."vendorId" AND p."liveId"=f."liveId" AND p."versionId"=f."versionId" AND p."ingressFrameId"=f.id
  WHERE f."vendorId"=vendor_key AND f."liveId"=live_key AND f."versionId"=version_key AND f."runId"=run_key
   AND (f.outcome='pending' OR (f."routeKind" IN ('form','landing','landing_step') AND
    (f.outcome<>'responded' OR f."httpStatus"<>200 OR p."eventId" IS NULL OR p."sourceKind"<>'registration')))) THEN RETURN FALSE; END IF;
 IF EXISTS(SELECT 1 FROM public."LiveMetricVisitPage" p LEFT JOIN public."LiveMetricIngressFrame" f
  ON f.id=p."ingressFrameId" AND f."vendorId"=p."vendorId" AND f."liveId"=p."liveId" AND f."versionId"=p."versionId" AND f."runId"=run_key
  LEFT JOIN public."LiveMetricVisitIntent" i ON i."vendorId"=p."vendorId" AND i."liveId"=p."liveId" AND i."versionId"=p."versionId" AND i."eventId"=p."eventId"
  WHERE p."vendorId"=vendor_key AND p."liveId"=live_key AND p."versionId"=version_key AND
   (f.id IS NULL OR p."sourceKind"='unknown' OR p."lossAt" IS NOT NULL OR p."issuedAt"<f."admittedAt" OR p."issuedAt">s."sealedAt"
    OR (p."sourceKind"='registration' AND (f."routeKind" NOT IN ('form','landing','landing_step') OR i."eventId" IS NULL
     OR i."preparedAt"<p."issuedAt" OR i."preparedAt">=s."sealedAt" OR NOT EXISTS(SELECT 1 FROM public."LiveMetricVisit" v
      WHERE v."vendorId"=p."vendorId" AND v."liveId"=p."liveId" AND v."versionId"=p."versionId" AND v."eventId"=p."eventId" AND v."visitorId"=i."visitorId"
       AND v."visitedAt">=i."preparedAt" AND v."visitedAt"<s."sealedAt")))
    OR (p."sourceKind"='viewer' AND f."routeKind"<>'viewer'))) THEN RETURN FALSE; END IF;
 IF EXISTS(SELECT 1 FROM public."LiveMetricVisitIntent" i LEFT JOIN public."LiveMetricVisitPage" p
  ON p."vendorId"=i."vendorId" AND p."liveId"=i."liveId" AND p."versionId"=i."versionId" AND p."eventId"=i."eventId"
  WHERE i."vendorId"=vendor_key AND i."liveId"=live_key AND i."versionId"=version_key AND p."eventId" IS NULL) THEN RETURN FALSE; END IF;
 IF EXISTS(SELECT 1 FROM public."LiveMetricVisit" v LEFT JOIN public."LiveMetricVisitPage" p
  ON p."vendorId"=v."vendorId" AND p."liveId"=v."liveId" AND p."versionId"=v."versionId" AND p."eventId"=v."eventId"
  LEFT JOIN public."LiveMetricVisitIntent" i ON i."vendorId"=v."vendorId" AND i."liveId"=v."liveId" AND i."versionId"=v."versionId" AND i."eventId"=v."eventId"
  WHERE v."vendorId"=vendor_key AND v."liveId"=live_key AND v."versionId"=version_key AND
   (p."eventId" IS NULL OR (p."sourceKind"='registration' AND (i."visitorId" IS DISTINCT FROM v."visitorId" OR v."visitedAt"<i."preparedAt" OR v."visitedAt">=s."sealedAt")))) THEN RETURN FALSE; END IF;
 RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION public.wp20_metric_unproven_coverage_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.status='covered' AND NEW.kind='viewing' THEN
  RAISE EXCEPTION 'metric coverage requires trusted source proof' USING ERRCODE='23514'; END IF;
 IF NEW.status='covered' AND NEW.kind='visits' AND (NEW."ingressProofVersion" IS DISTINCT FROM 1 OR NEW."ingressRunId" IS NULL OR NEW."ingressReceipt" IS NULL
  OR NOT public.wp20_metric_visits_proof_ready(NEW."vendorId",NEW."liveId",NEW."versionId",NEW."ingressRunId",NEW."startAt",NEW."endAt",NEW."ingressReceipt")) THEN
  RAISE EXCEPTION 'metric coverage requires trusted source proof' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.wp20_metric_ingress_frame_digest(TEXT,TEXT,TEXT,TEXT),public.wp20_metric_ingress_visit_frontier(),
 public.wp20_metric_visits_proof_ready(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,JSONB) FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_ingress_frame_digest(TEXT,TEXT,TEXT,TEXT),public.wp20_metric_ingress_visit_frontier(),public.wp20_metric_visits_proof_ready(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,JSONB) FROM %I',api_role);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
  WHERE c.oid='public."LiveMetricCoverageAudit"'::regclass AND a.grantee<>c.relowner AND a.privilege_type='INSERT')
 OR EXISTS(SELECT 1 FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid CROSS JOIN LATERAL aclexplode(col.attacl) a
  WHERE c.oid='public."LiveMetricCoverageAudit"'::regclass AND col.attnum>0 AND NOT col.attisdropped
   AND a.grantee<>c.relowner AND a.privilege_type='INSERT') THEN
  RAISE EXCEPTION 'metric ingress proofs require owner-only insertion' USING ERRCODE='23514'; END IF;
END $$;
COMMIT;
