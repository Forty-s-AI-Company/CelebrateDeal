-- Existing reports have no trustworthy order revision. Keep history but do
-- not let an old ready result become current merely by applying this migration.
ALTER TABLE public."LiveMetricReport" ADD COLUMN "inputOrderRevision" BIGINT CHECK ("inputOrderRevision">=0);
UPDATE public."LiveMetricReport" SET status='stale',result=NULL,"leaseOwner"=NULL,"leaseExpiresAt"=NULL
 WHERE status IN ('queued','running','ready');


CREATE OR REPLACE FUNCTION public.wp20_metric_report_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE current_revision BIGINT; current_order_revision BIGINT;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'metric writes require read committed isolation' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND current_setting('wp20.report_writer',true) IS DISTINCT FROM 'create' THEN
    RAISE EXCEPTION 'metric report requires creation function' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND NEW.status='queued' THEN
    RAISE EXCEPTION 'queued metric report is immutable; create replacement' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND NEW.status IN ('running','ready')
    AND current_setting('wp20.report_writer',true) IS DISTINCT FROM (CASE WHEN NEW.status='running' THEN 'claim' ELSE 'finish' END) THEN
    RAISE EXCEPTION 'metric report requires worker function' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW."id",NEW."vendorId",NEW."liveId",NEW."versionId",NEW."windowStartAt",NEW."windowEndAt",NEW."inputRevision")
    IS DISTINCT FROM (OLD."id",OLD."vendorId",OLD."liveId",OLD."versionId",OLD."windowStartAt",OLD."windowEndAt",OLD."inputRevision") THEN
    RAISE EXCEPTION 'metric report input is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND NEW."inputOrderRevision" IS DISTINCT FROM OLD."inputOrderRevision" THEN
    RAISE EXCEPTION 'metric order input is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW."status" IN ('queued','running','ready') THEN
    current_order_revision := public.wp20_metric_order_revision(NEW."vendorId",NEW."liveId");
    IF TG_OP='INSERT' THEN NEW."inputOrderRevision":=current_order_revision; END IF;
    IF current_order_revision IS NULL OR NEW."inputOrderRevision" IS DISTINCT FROM current_order_revision THEN
      RAISE EXCEPTION 'metric order input is stale' USING ERRCODE='23514';
    END IF;
    -- Workers lock the version before the report. SHARE also closes the race
    -- between a report INSERT and an evidence-triggered revision increment.
    SELECT "sourceRevision" INTO current_revision FROM public."LiveMetricVersion"
    WHERE "id"=NEW."versionId" AND "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" FOR SHARE;
    IF NOT FOUND OR current_revision<>NEW."inputRevision" THEN
      RAISE EXCEPTION 'metric report input is stale' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.wp20_metric_report_create(
  vendor_id TEXT, live_id TEXT, version_id TEXT, report_id TEXT,
  window_start TIMESTAMPTZ(3), window_end TIMESTAMPTZ(3), input_revision BIGINT, expires_at TIMESTAMPTZ(3)
) RETURNS INTEGER LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE previous_writer TEXT; order_revision BIGINT;
BEGIN

  -- No shared source-row lock: payment changes append events. Version/report
  -- locks retain metric lifecycle ordering. Every reader rechecks event count.
  order_revision := public.wp20_metric_order_revision(vendor_id,live_id);
  PERFORM 1 FROM public."LiveMetricVersion" WHERE id=version_id AND "vendorId"=vendor_id AND "liveId"=live_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'metric version missing' USING ERRCODE='23514'; END IF;
  UPDATE public."LiveMetricReport" SET status='stale',result=NULL,"leaseOwner"=NULL,"leaseExpiresAt"=NULL
    WHERE "vendorId"=vendor_id AND "liveId"=live_id AND "versionId"=version_id
      AND status IN ('queued','running','ready') AND "inputOrderRevision" IS DISTINCT FROM order_revision;

  IF window_end>clock_timestamp() THEN RAISE EXCEPTION 'metric report window must have ended' USING ERRCODE='23514'; END IF;
  previous_writer := current_setting('wp20.report_writer',true);
  PERFORM set_config('wp20.report_writer','create',true);
  INSERT INTO public."LiveMetricReport" (id,"vendorId","liveId","versionId","windowStartAt","windowEndAt","inputRevision","expiresAt")
    VALUES (report_id,vendor_id,live_id,version_id,window_start,window_end,input_revision,expires_at);
  PERFORM set_config('wp20.report_writer',coalesce(previous_writer,''),true);
  RETURN 1;
END $$;

CREATE OR REPLACE FUNCTION public.wp20_metric_report_claim(
  vendor_id TEXT, live_id TEXT, version_id TEXT, report_id TEXT,
  worker_id TEXT, lease_until TIMESTAMPTZ(3)
) RETURNS INTEGER LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE changed INTEGER; previous_writer TEXT; order_revision BIGINT;
BEGIN

  -- No shared source-row lock: payment changes append events. Version/report
  -- locks retain metric lifecycle ordering. Every reader rechecks event count.
  order_revision := public.wp20_metric_order_revision(vendor_id,live_id);
  IF worker_id IS NULL OR length(worker_id)=0 OR lease_until<=clock_timestamp()
    OR lease_until>clock_timestamp()+INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'invalid metric worker lease' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public."LiveMetricVersion"
    WHERE id=version_id AND "vendorId"=vendor_id AND "liveId"=live_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF EXISTS(SELECT 1 FROM public."LiveMetricReport" WHERE id=report_id AND "vendorId"=vendor_id
      AND "liveId"=live_id AND "versionId"=version_id AND "inputOrderRevision" IS DISTINCT FROM order_revision) THEN
    UPDATE public."LiveMetricReport" SET status='stale',result=NULL,"leaseOwner"=NULL,"leaseExpiresAt"=NULL
      WHERE id=report_id AND "vendorId"=vendor_id AND "liveId"=live_id AND "versionId"=version_id AND status IN ('queued','running','ready');
    RETURN 0;
  END IF;

  UPDATE public."LiveMetricReport" SET status='failed',"errorCode"='attempt_limit',"leaseOwner"=NULL,"leaseExpiresAt"=NULL
    WHERE id=report_id AND "vendorId"=vendor_id AND "liveId"=live_id AND "versionId"=version_id
      AND attempts>=5 AND (status='queued' OR (status='running' AND "leaseExpiresAt"<=clock_timestamp()));
  previous_writer := current_setting('wp20.report_writer',true);
  PERFORM set_config('wp20.report_writer','claim',true);
  UPDATE public."LiveMetricReport" SET status='running',"leaseOwner"=worker_id,
    "leaseExpiresAt"=lease_until,attempts=attempts+1
    WHERE id=report_id AND "vendorId"=vendor_id AND "liveId"=live_id AND "versionId"=version_id
      AND (status='queued' OR (status='running' AND "leaseExpiresAt"<=clock_timestamp()))
      AND attempts<5 AND "expiresAt">clock_timestamp();
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM set_config('wp20.report_writer',coalesce(previous_writer,''),true);
  RETURN changed;
END $$;

CREATE OR REPLACE FUNCTION public.wp20_metric_report_finish(
  vendor_id TEXT, live_id TEXT, version_id TEXT, report_id TEXT,
  worker_id TEXT, report_result JSONB
) RETURNS INTEGER LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE changed INTEGER; previous_writer TEXT; order_revision BIGINT;
BEGIN

  -- No shared source-row lock: payment changes append events. Version/report
  -- locks retain metric lifecycle ordering. Every reader rechecks event count.
  order_revision := public.wp20_metric_order_revision(vendor_id,live_id);
  IF report_result IS NULL THEN RAISE EXCEPTION 'metric result required' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public."LiveMetricVersion"
    WHERE id=version_id AND "vendorId"=vendor_id AND "liveId"=live_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF EXISTS(SELECT 1 FROM public."LiveMetricReport" WHERE id=report_id AND "vendorId"=vendor_id
      AND "liveId"=live_id AND "versionId"=version_id AND "inputOrderRevision" IS DISTINCT FROM order_revision) THEN
    UPDATE public."LiveMetricReport" SET status='stale',result=NULL,"leaseOwner"=NULL,"leaseExpiresAt"=NULL
      WHERE id=report_id AND "vendorId"=vendor_id AND "liveId"=live_id AND "versionId"=version_id AND status IN ('queued','running','ready');
    RETURN 0;
  END IF;

  previous_writer := current_setting('wp20.report_writer',true);
  PERFORM set_config('wp20.report_writer','finish',true);
  UPDATE public."LiveMetricReport" SET status='ready',result=report_result,
    "finishedAt"=clock_timestamp(),"leaseOwner"=NULL,"leaseExpiresAt"=NULL
    WHERE id=report_id AND "vendorId"=vendor_id AND "liveId"=live_id AND "versionId"=version_id
      AND status='running' AND "leaseOwner"=worker_id AND "leaseExpiresAt">clock_timestamp()
      AND "expiresAt">clock_timestamp();
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM set_config('wp20.report_writer',coalesce(previous_writer,''),true);
  RETURN changed;
END $$;
