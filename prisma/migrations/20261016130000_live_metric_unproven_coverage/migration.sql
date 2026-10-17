BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- No source proof exists for these kinds yet. A trusted positive producer and
-- matching reader/fence migration must replace this gate before enabling them.
-- Keeping the raw legacy audit is evidence, not permission to certify it.
-- Existing LiveMetricCoverageAudit_guard (20261015120000) already rejects ALL
-- audit UPDATEs and direct DELETEs, so old flags cannot be revised to current.
CREATE FUNCTION public.wp20_metric_unproven_coverage_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.status='covered' AND NEW.kind IN ('visits','viewing') THEN
  RAISE EXCEPTION 'metric coverage requires trusted source proof' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricCoverageAudit_unproven_guard" BEFORE INSERT ON public."LiveMetricCoverageAudit"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_unproven_coverage_guard();
REVOKE ALL ON FUNCTION public.wp20_metric_unproven_coverage_guard() FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_unproven_coverage_guard() FROM %I',api_role);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public.wp20_metric_unproven_coverage_guard()'::regprocedure AND a.grantee<>p.proowner)
 THEN RAISE EXCEPTION 'unexpected unproven coverage privileges' USING ERRCODE='23514'; END IF;
END $$;
-- Existing version trigger increments revision and clears/invalidates leases,
-- results and completion projections through the existing revision binding.
-- This also protects old readers/workers still comparing audit.sourceRevision.
-- Only versions with a CURRENT unsupported positive flag are affected.
UPDATE public."LiveMetricVersion" v SET "sourceRevision"=v."sourceRevision"+1
WHERE EXISTS(SELECT 1 FROM public."LiveMetricCoverageAudit" a
 WHERE a."vendorId"=v."vendorId" AND a."liveId"=v."liveId" AND a."versionId"=v.id
  AND a.kind IN ('visits','viewing') AND a.status='covered' AND a."sourceRevision"=v."sourceRevision");
COMMIT;
