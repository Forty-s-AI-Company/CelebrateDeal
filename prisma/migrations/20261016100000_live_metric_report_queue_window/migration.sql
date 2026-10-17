-- Report creation only retires stale predecessors for the SAME window.
-- A window revision is not comparable with another window's revision.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.wp20_metric_report_create(
 vendor_id TEXT,live_id TEXT,version_id TEXT,report_id TEXT,
 window_start TIMESTAMPTZ(3),window_end TIMESTAMPTZ(3),input_revision BIGINT,expires_at TIMESTAMPTZ(3)
) RETURNS INTEGER LANGUAGE plpgsql SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE previous_writer TEXT; order_revision BIGINT; registration_revision BIGINT;
BEGIN
 PERFORM 1 FROM public."LiveMetricVersion" WHERE id=version_id AND "vendorId"=vendor_id AND "liveId"=live_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'metric version missing' USING ERRCODE='23514'; END IF;
 IF window_end>clock_timestamp() THEN RAISE EXCEPTION 'metric report window must have ended' USING ERRCODE='23514'; END IF;
 order_revision:=public.wp20_metric_order_window_revision(vendor_id,window_start,window_end);
 registration_revision:=public.wp20_metric_registration_revision(vendor_id,live_id);
 UPDATE public."LiveMetricReport" SET status='stale',result=NULL,"leaseOwner"=NULL,"leaseExpiresAt"=NULL
  WHERE "vendorId"=vendor_id AND "liveId"=live_id AND "versionId"=version_id
   AND "windowStartAt"=window_start AND "windowEndAt"=window_end
   AND status IN ('queued','running','ready')
   AND ("inputOrderRevision" IS DISTINCT FROM order_revision
    OR "inputOrderTenantRevision" IS DISTINCT FROM order_revision
    OR "inputRegistrationRevision" IS DISTINCT FROM registration_revision
    OR "inputRevision" IS DISTINCT FROM input_revision OR "expiresAt"<=clock_timestamp());
 previous_writer:=current_setting('wp20.report_writer',true);
 PERFORM set_config('wp20.report_writer','create',true);
 INSERT INTO public."LiveMetricReport" (id,"vendorId","liveId","versionId","windowStartAt","windowEndAt","inputRevision","expiresAt")
  VALUES (report_id,vendor_id,live_id,version_id,window_start,window_end,input_revision,expires_at);
 PERFORM set_config('wp20.report_writer',coalesce(previous_writer,''),true);
 RETURN 1;
END $$;
-- Replacement preserves the existing invoker rights and revoked EXEC ACL.
COMMIT;
