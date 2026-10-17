BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Lock version rows before taking the page DDL lock, matching active issuers.
-- Existing version guard invalidates leases/results in this same transaction.
UPDATE public."LiveMetricVersion" SET "sourceRevision"="sourceRevision"+1;
-- Existing history cannot be retroactively classified from today's form.
ALTER TABLE public."LiveMetricVisitPage"
 ADD COLUMN "sourceKind" TEXT NOT NULL DEFAULT 'unknown',
 ADD COLUMN "sourceFormId" TEXT,
 ADD CONSTRAINT "LiveMetricVisitPage_source_check" CHECK (
  "sourceKind" IN ('unknown','viewer','registration')
  AND (("sourceKind"='registration' AND "sourceFormId" IS NOT NULL AND "sourceFormId" ~ '^[A-Za-z0-9_-]{1,128}$')
   OR ("sourceKind"<>'registration' AND "sourceFormId" IS NULL))
 );
CREATE FUNCTION public.wp20_metric_visit_page_source_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off SET timezone='UTC' AS $$
BEGIN
 IF NEW."sourceKind"='registration' THEN
  -- This trigger sorts before the existing page guard. Preserve the issuer's
  -- advisory -> Live/Form -> version lock order even for direct SQL writers.
  PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array('wp20_metric_visit_page',NEW."vendorId",NEW."liveId")::text,0));
  PERFORM l.id FROM public."Live" l
   JOIN public."RegistrationForm" f ON f.id=l."formId" AND f."vendorId"=l."vendorId"
   LEFT JOIN public."SalesProject" p ON p.id=f."projectId" AND p."vendorId"=f."vendorId"
   WHERE l.id=NEW."liveId" AND l."vendorId"=NEW."vendorId" AND f.id=NEW."sourceFormId" AND f."isActive"
    AND (f."projectId" IS NULL OR (p.status='published' AND p."publishedAt" IS NOT NULL)) FOR SHARE OF l,f;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration visit source unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricVisitPage_binding_guard" BEFORE INSERT ON public."LiveMetricVisitPage"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_visit_page_source_guard();
-- Existing immutable whole-row guard protects both new columns on UPDATE.
-- RLS and relation/column ACL policy remain private; no new public reader.
REVOKE ALL ON FUNCTION public.wp20_metric_visit_page_source_guard() FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_visit_page_source_guard() FROM %I',api_role);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
  WHERE c.oid='public."LiveMetricVisitPage"'::regclass AND a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid CROSS JOIN LATERAL aclexplode(col.attacl) a
  WHERE c.oid='public."LiveMetricVisitPage"'::regclass AND col.attnum>0 AND NOT col.attisdropped AND a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public.wp20_metric_visit_page_source_guard()'::regprocedure AND a.grantee<>p.proowner)
 THEN RAISE EXCEPTION 'unexpected visit source privileges' USING ERRCODE='23514'; END IF;
END $$;
-- Never relabel old facts or revive leases.
COMMIT;
