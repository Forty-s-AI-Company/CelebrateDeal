-- Each visit keeps its own server-observed time. Existing firstVisitedAt rows
-- are not backfilled: they cannot prove historical collection completeness.
CREATE TABLE public."LiveMetricVisit" (
  id TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "liveId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "visitorId" TEXT NOT NULL,
  "visitedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "LiveMetricVisit_identity_check" CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  CONSTRAINT "LiveMetricVisit_event_check" CHECK ("eventId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  CONSTRAINT "LiveMetricVisit_visitor_fkey" FOREIGN KEY ("vendorId","liveId","versionId","visitorId")
    REFERENCES public."LiveMetricVisitor"("vendorId","liveId","versionId",id) ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "LiveMetricVisit_scope_event_key" ON public."LiveMetricVisit"("vendorId","liveId","versionId","visitorId","eventId");
CREATE INDEX "LiveMetricVisit_scope_time_idx" ON public."LiveMetricVisit"("vendorId","liveId","versionId","visitedAt",id);
CREATE INDEX "LiveMetricVisit_scope_visitor_idx" ON public."LiveMetricVisit"("vendorId","liveId","versionId","visitorId");

CREATE FUNCTION public.wp20_metric_visit_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'metric writes require read committed isolation' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'metric visit facts are immutable' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public."LiveMetricVersion" WHERE id=NEW."versionId"
    AND "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" FOR SHARE;
  IF NOT EXISTS (
    SELECT 1 FROM public."LiveMetricVersion" v JOIN public."LiveMetricVisitor" b
      ON b."versionId"=v.id AND b."vendorId"=v."vendorId" AND b."liveId"=v."liveId"
    WHERE v.id=NEW."versionId" AND v."vendorId"=NEW."vendorId" AND v."liveId"=NEW."liveId" AND b.id=NEW."visitorId"
      AND v."collectionEnabled" AND v."expiresAt">clock_timestamp()
      AND NEW."visitedAt">=v."collectionStartedAt" AND NEW."visitedAt">=b."firstVisitedAt"
      -- Compare at the column's millisecond precision, using PostgreSQL's same
      -- rounding rule as visitor timestamps and the server visit writer.
      AND NEW."visitedAt"<v."expiresAt" AND NEW."visitedAt"<=clock_timestamp()::timestamptz(3)
  ) THEN
    RAISE EXCEPTION 'metric visit scope or lifetime invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricVisit_guard" BEFORE INSERT OR UPDATE ON public."LiveMetricVisit"
  FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_visit_guard();

-- Share the version/report lock order with report creation. A late insert or
-- deletion invalidates precisely the windows containing that visit, including
-- running jobs, so a stale calculation cannot be committed as ready.
CREATE FUNCTION public.wp20_metric_visit_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE fact public."LiveMetricVisit";
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'metric writes require read committed isolation' USING ERRCODE='23514';
  END IF;
  fact:=NEW;
  PERFORM 1 FROM public."LiveMetricVersion" WHERE id=fact."versionId"
    AND "vendorId"=fact."vendorId" AND "liveId"=fact."liveId" FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public."LiveMetricReport" SET status='stale',result=NULL,"leaseOwner"=NULL,"leaseExpiresAt"=NULL
    WHERE "vendorId"=fact."vendorId" AND "liveId"=fact."liveId" AND "versionId"=fact."versionId"
      AND "windowStartAt"<=fact."visitedAt" AND "windowEndAt">fact."visitedAt" AND status<>'stale';
  RETURN NULL;
END $$;
CREATE TRIGGER "LiveMetricVisit_changed" AFTER INSERT ON public."LiveMetricVisit"
  FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_visit_changed();

-- One report update per deleted batch, rather than one update per visit.
-- Cleanup callers must acquire version locks before deleting child rows;
-- deterministic version ordering here also covers multi-version batches.
CREATE FUNCTION public.wp20_metric_visits_deleted() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'metric writes require read committed isolation' USING ERRCODE='23514';
  END IF;
  PERFORM v.id FROM public."LiveMetricVersion" v
    WHERE EXISTS (SELECT 1 FROM deleted_visits d WHERE d."versionId"=v.id
      AND d."vendorId"=v."vendorId" AND d."liveId"=v."liveId")
    ORDER BY v.id FOR SHARE;
  UPDATE public."LiveMetricReport" r SET status='stale',result=NULL,"leaseOwner"=NULL,"leaseExpiresAt"=NULL
    WHERE r.status<>'stale' AND EXISTS (SELECT 1 FROM deleted_visits d
      WHERE d."versionId"=r."versionId" AND d."vendorId"=r."vendorId" AND d."liveId"=r."liveId"
        AND r."windowStartAt"<=d."visitedAt" AND r."windowEndAt">d."visitedAt");
  RETURN NULL;
END $$;
CREATE TRIGGER "LiveMetricVisit_deleted" AFTER DELETE ON public."LiveMetricVisit"
  REFERENCING OLD TABLE AS deleted_visits FOR EACH STATEMENT
  EXECUTE FUNCTION public.wp20_metric_visits_deleted();

ALTER TABLE public."LiveMetricVisit" ENABLE ROW LEVEL SECURITY;
-- Even the server writer must use DELETE so report invalidation cannot be bypassed.
CREATE FUNCTION public.wp20_metric_visit_no_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
BEGIN
  RAISE EXCEPTION 'metric visits require scoped deletion' USING ERRCODE='23514';
END $$;
CREATE TRIGGER "LiveMetricVisit_no_truncate" BEFORE TRUNCATE ON public."LiveMetricVisit"
  FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();
REVOKE ALL ON public."LiveMetricVisit" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wp20_metric_visit_guard(),public.wp20_metric_visit_changed(),public.wp20_metric_visit_no_truncate(),public.wp20_metric_visits_deleted() FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL ON public."LiveMetricVisit" FROM %I',api_role);
      EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_visit_guard(),public.wp20_metric_visit_changed(),public.wp20_metric_visit_no_truncate(),public.wp20_metric_visits_deleted() FROM %I',api_role);
    END IF;
  END LOOP;
END $$;
