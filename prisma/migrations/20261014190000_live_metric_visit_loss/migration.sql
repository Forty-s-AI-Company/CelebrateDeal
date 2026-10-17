-- Record missing evidence, not the erased visitor. One missing timestamp makes
-- its millisecond unavailable for exact visit statistics until version removal.
CREATE TABLE public."LiveMetricVisitLoss" (
  "vendorId" TEXT NOT NULL,
  "liveId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "visitedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "LiveMetricVisitLoss_pkey" PRIMARY KEY ("vendorId","liveId","versionId","visitedAt"),
  CONSTRAINT "LiveMetricVisitLoss_version_fkey" FOREIGN KEY ("vendorId","liveId","versionId")
    REFERENCES public."LiveMetricVersion"("vendorId","liveId",id) ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE OR REPLACE FUNCTION public.wp20_metric_visits_deleted() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'metric writes require read committed isolation' USING ERRCODE='23514';
  END IF;
  PERFORM v.id FROM public."LiveMetricVersion" v
    WHERE EXISTS (SELECT 1 FROM deleted_visits d WHERE d."versionId"=v.id
      AND d."vendorId"=v."vendorId" AND d."liveId"=v."liveId")
    ORDER BY v.id FOR SHARE;
  -- A version cascade needs no surviving provenance; joining the still-existing
  -- parent avoids resurrecting records or failing its foreign key during erasure.
  INSERT INTO public."LiveMetricVisitLoss" ("vendorId","liveId","versionId","visitedAt")
    SELECT DISTINCT d."vendorId",d."liveId",d."versionId",d."visitedAt"
    FROM deleted_visits d JOIN public."LiveMetricVersion" v
      ON v.id=d."versionId" AND v."vendorId"=d."vendorId" AND v."liveId"=d."liveId"
    ORDER BY d."vendorId",d."liveId",d."versionId",d."visitedAt"
    ON CONFLICT DO NOTHING;
  UPDATE public."LiveMetricReport" r SET status='stale',result=NULL,"leaseOwner"=NULL,"leaseExpiresAt"=NULL
    WHERE r.status<>'stale' AND EXISTS (SELECT 1 FROM deleted_visits d
      WHERE d."versionId"=r."versionId" AND d."vendorId"=r."vendorId" AND d."liveId"=r."liveId"
        AND r."windowStartAt"<=d."visitedAt" AND r."windowEndAt">d."visitedAt");
  RETURN NULL;
END $$;

CREATE FUNCTION public.wp20_metric_visit_loss_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS (SELECT 1 FROM public."LiveMetricVersion"
    WHERE id=OLD."versionId" AND "vendorId"=OLD."vendorId" AND "liveId"=OLD."liveId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'metric loss provenance is immutable while version exists' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "LiveMetricVisitLoss_immutable" BEFORE UPDATE OR DELETE ON public."LiveMetricVisitLoss"
  FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_visit_loss_immutable();
CREATE TRIGGER "LiveMetricVisitLoss_no_truncate" BEFORE TRUNCATE ON public."LiveMetricVisitLoss"
  FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();
ALTER TABLE public."LiveMetricVisitLoss" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."LiveMetricVisitLoss" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wp20_metric_visit_loss_immutable() FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON public."LiveMetricVisitLoss" FROM %I',api_role);
      EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_visit_loss_immutable() FROM %I',api_role);
    END IF;
  END LOOP;
END $$;
