-- Internal report-bound projection. One row contains the complete manifest and
-- candidate facts atomically; absence is unknown, an empty array is known empty.
CREATE TABLE public."LiveMetricCompletionProjection" (
 "reportId" TEXT PRIMARY KEY REFERENCES public."LiveMetricReport"(id) ON DELETE CASCADE,
 "sourceRevision" BIGINT NOT NULL CHECK ("sourceRevision">=0),
 "algorithmVersion" INTEGER NOT NULL CHECK ("algorithmVersion"=1),
 "cohortCount" INTEGER NOT NULL CHECK ("cohortCount">=0),
 "rowCount" INTEGER NOT NULL CHECK ("rowCount">=0 AND "rowCount"<=1000000),
 rows JSONB NOT NULL CHECK (jsonb_typeof(rows)='array'),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT "completion_row_count_matches" CHECK ("rowCount"=jsonb_array_length(rows))
);
ALTER TABLE public."LiveMetricCompletionProjection" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."LiveMetricCompletionProjection" FROM PUBLIC;

CREATE FUNCTION public.wp20_metric_completion_publish(
 vendor_id TEXT,live_id TEXT,version_id TEXT,report_id TEXT,worker_id TEXT,
 source_revision BIGINT,cohort_count INTEGER,facts JSONB
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE report public."LiveMetricReport"%ROWTYPE; current_revision BIGINT; actual_cohort BIGINT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'completion write requires read committed' USING ERRCODE='23514';
 END IF;
 IF facts IS NULL OR jsonb_typeof(facts)<>'array' OR cohort_count IS NULL OR cohort_count<0
   OR source_revision IS NULL OR source_revision<0 THEN
  RAISE EXCEPTION 'invalid completion manifest' USING ERRCODE='23514';
 END IF;
 IF jsonb_array_length(facts)>cohort_count OR cohort_count>1000000 OR pg_column_size(facts)>67108864 THEN
  RAISE EXCEPTION 'completion manifest limit exceeded' USING ERRCODE='23514';
 END IF;
 -- Input-only checks require no locks and reject malformed batches early.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(facts) f WHERE jsonb_typeof(f)<>'object') THEN
  RAISE EXCEPTION 'invalid completion fact shape' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(facts) f WHERE
   NOT (f ? 'personId' AND f ? 'firstCompletedAtMs')
   OR jsonb_typeof(f->'personId')<>'string' OR jsonb_typeof(f->'firstCompletedAtMs')<>'number'
   OR (SELECT count(*) FROM jsonb_object_keys(f))<>2) THEN
  RAISE EXCEPTION 'invalid completion fact shape' USING ERRCODE='23514';
 END IF;
 IF (SELECT count(DISTINCT f->>'personId') FROM jsonb_array_elements(facts) f)<>jsonb_array_length(facts) THEN
  RAISE EXCEPTION 'duplicate completion person' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(facts) f WHERE
  (f->>'firstCompletedAtMs')::numeric<>trunc((f->>'firstCompletedAtMs')::numeric)
  OR (f->>'firstCompletedAtMs')::numeric<0 OR (f->>'firstCompletedAtMs')::numeric>8640000000000000) THEN
  RAISE EXCEPTION 'completion fact outside timestamp range' USING ERRCODE='23514';
 END IF;
 -- Match the established version -> report lock order before publishing.
 SELECT "sourceRevision" INTO current_revision FROM public."LiveMetricVersion"
  WHERE id=version_id AND "vendorId"=vendor_id AND "liveId"=live_id FOR UPDATE;
 IF NOT FOUND OR current_revision<>source_revision THEN RETURN 0; END IF;
 SELECT * INTO report FROM public."LiveMetricReport" WHERE id=report_id
  AND "vendorId"=vendor_id AND "liveId"=live_id AND "versionId"=version_id FOR UPDATE;
 IF NOT FOUND OR report.status<>'running' OR report."leaseOwner" IS DISTINCT FROM worker_id
  OR report."leaseExpiresAt"<=clock_timestamp() OR report."expiresAt"<=clock_timestamp()
  OR report."inputRevision"<>source_revision
  OR report."inputOrderRevision" IS DISTINCT FROM public.wp20_metric_order_revision(vendor_id,live_id)
 THEN RETURN 0; END IF;
 SELECT count(*) INTO actual_cohort FROM public."LiveMetricRegistration"
  WHERE "vendorId"=vendor_id AND "liveId"=live_id AND "versionId"=version_id
    AND "verifiedAt">=report."windowStartAt" AND "verifiedAt"<report."windowEndAt";
 IF actual_cohort<>cohort_count THEN RAISE EXCEPTION 'completion cohort changed' USING ERRCODE='23514'; END IF;
 -- Scope-dependent membership remains under the version/report locks.
 IF EXISTS(
  SELECT 1 FROM jsonb_to_recordset(facts) AS f("personId" text,"firstCompletedAtMs" numeric)
  LEFT JOIN public."LiveMetricRegistration" g
   ON g.id=f."personId" AND g."vendorId"=vendor_id AND g."liveId"=live_id AND g."versionId"=version_id
    AND g."verifiedAt">=report."windowStartAt" AND g."verifiedAt"<report."windowEndAt"
    AND f."firstCompletedAtMs">=extract(epoch FROM g."verifiedAt")*1000
    AND f."firstCompletedAtMs"<extract(epoch FROM report."windowEndAt")*1000
  WHERE g.id IS NULL) THEN
  RAISE EXCEPTION 'completion fact outside cohort window' USING ERRCODE='23514';
 END IF;
 -- Validation may consume the rest of a short lease; do not publish after expiry.
 IF report."leaseExpiresAt"<=clock_timestamp() OR report."expiresAt"<=clock_timestamp() THEN RETURN 0; END IF;
 INSERT INTO public."LiveMetricCompletionProjection" ("reportId","sourceRevision","algorithmVersion","cohortCount","rowCount",rows)
 VALUES (report_id,source_revision,1,cohort_count,jsonb_array_length(facts),facts)
 ON CONFLICT ("reportId") DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public."LiveMetricCompletionProjection" p WHERE p."reportId"=report_id
  AND p."sourceRevision"=source_revision AND p."cohortCount"=cohort_count AND p.rows=facts) THEN
  RAISE EXCEPTION 'completion projection conflict' USING ERRCODE='23514';
 END IF;
 RETURN 1;
END $$;
REVOKE ALL ON FUNCTION public.wp20_metric_completion_publish(text,text,text,text,text,bigint,integer,jsonb) FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON public."LiveMetricCompletionProjection" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_completion_publish(text,text,text,text,text,bigint,integer,jsonb) FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
