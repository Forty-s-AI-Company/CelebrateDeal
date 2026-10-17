BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Retain legacy unknowns. No backfill, epoch claim or positive coverage.
ALTER TABLE public."LiveMetricIngressFrame" ADD CONSTRAINT "LiveMetricIngressFrame_vendorId_liveId_versionId_id_key" UNIQUE ("vendorId","liveId","versionId",id);
ALTER TABLE public."LiveMetricVisitPage" ADD COLUMN "ingressFrameId" TEXT;
ALTER TABLE public."LiveMetricPlaybackIntake" ADD COLUMN "ingressFrameId" TEXT;
CREATE UNIQUE INDEX "LiveMetricVisitPage_ingressFrameId_key" ON public."LiveMetricVisitPage"("ingressFrameId");
CREATE UNIQUE INDEX "LiveMetricPlaybackIntake_ingressFrameId_key" ON public."LiveMetricPlaybackIntake"("ingressFrameId");
CREATE UNIQUE INDEX "LiveMetricVisitPage_ingress_scope_key" ON public."LiveMetricVisitPage"("vendorId","liveId","versionId","ingressFrameId");
CREATE UNIQUE INDEX "LiveMetricPlaybackIntake_ingress_scope_key" ON public."LiveMetricPlaybackIntake"("vendorId","liveId","versionId","ingressFrameId");
-- Deferred NO ACTION permits the canonical version cascade to remove both the
-- frame and its bound source, whichever child FK PostgreSQL visits first.
ALTER TABLE public."LiveMetricVisitPage" ADD CONSTRAINT "LiveMetricVisitPage_ingressFrame_fkey"
 FOREIGN KEY ("vendorId","liveId","versionId","ingressFrameId") REFERENCES public."LiveMetricIngressFrame"("vendorId","liveId","versionId",id) ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."LiveMetricPlaybackIntake" ADD CONSTRAINT "LiveMetricPlaybackIntake_ingressFrame_fkey"
 FOREIGN KEY ("vendorId","liveId","versionId","ingressFrameId") REFERENCES public."LiveMetricIngressFrame"("vendorId","liveId","versionId",id) ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION public.wp20_metric_ingress_source_allowed(vendor_key TEXT,live_key TEXT,version_key TEXT,frame_key TEXT,source_kind TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off AS $$
DECLARE source_run TEXT; route TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR pg_is_in_recovery() THEN
  RAISE EXCEPTION 'metric ingress source requires primary read committed' USING ERRCODE='23514';
 END IF;
 -- Caller already owns canonical Live/admission/Video/version locks. This
 -- function is private; it never grants browser or source coverage authority.
 PERFORM 1 FROM public."LiveMetricVersion" WHERE id=version_key AND "vendorId"=vendor_key AND "liveId"=live_key FOR SHARE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 SELECT id INTO source_run FROM public."LiveMetricIngressRun" WHERE "versionId"=version_key AND "vendorId"=vendor_key AND "liveId"=live_key FOR SHARE;
 IF NOT FOUND THEN RETURN frame_key IS NULL; END IF;
 -- Serialize consumers, then inspect used sources under a fresh RC snapshot.
 -- The shared precheck + BEFORE INSERT predicate closes the retry race without
 -- allowing duplicate source rows or converting a unique violation to success.
 SELECT "routeKind" INTO route FROM public."LiveMetricIngressFrame" WHERE id=frame_key AND "runId"=source_run AND "vendorId"=vendor_key AND "liveId"=live_key AND "versionId"=version_key FOR UPDATE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 IF EXISTS(SELECT 1 FROM public."LiveMetricVisitPage" WHERE "ingressFrameId"=frame_key)
  OR EXISTS(SELECT 1 FROM public."LiveMetricPlaybackIntake" WHERE "ingressFrameId"=frame_key) THEN RETURN FALSE; END IF;
 RETURN coalesce((source_kind='playback' AND route='playback') OR (source_kind='registration' AND route IN ('form','landing','landing_step')) OR (source_kind='viewer' AND route='viewer'),FALSE);
END $$;
CREATE FUNCTION public.wp20_metric_ingress_source_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off AS $$
DECLARE source_kind TEXT;
BEGIN
 IF TG_TABLE_NAME='LiveMetricPlaybackIntake' THEN source_kind:='playback'; ELSE source_kind:=NEW."sourceKind"; END IF;
 IF NOT public.wp20_metric_ingress_source_allowed(NEW."vendorId",NEW."liveId",NEW."versionId",NEW."ingressFrameId",source_kind) THEN
  RAISE EXCEPTION 'metric ingress source requires matching admitted frame' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
-- Names sort after original guards, so their canonical scope/time locks run
-- first even for direct trusted SQL. Whole-row guards protect new fields later.
CREATE TRIGGER "LiveMetricVisitPage_ingress_guard" BEFORE INSERT ON public."LiveMetricVisitPage" FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_ingress_source_guard();
CREATE TRIGGER "LiveMetricPlaybackIntake_ingress_guard" BEFORE INSERT ON public."LiveMetricPlaybackIntake" FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_ingress_source_guard();
DO $$ DECLARE relation TEXT; BEGIN
 FOREACH relation IN ARRAY ARRAY['LiveMetricVisitPage','LiveMetricPlaybackIntake'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=format('public.%I',relation)::regclass
    AND tgname=relation||'_guard' AND NOT tgisinternal AND (tgtype::int & 7)=7 AND tgenabled='O')
   OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=format('public.%I',relation)::regclass
    AND NOT tgisinternal AND (tgtype::int & 7)=7 AND tgname<>relation||'_ingress_guard'
    AND tgname::text COLLATE "C">=(relation||'_ingress_guard') COLLATE "C") THEN
   RAISE EXCEPTION 'metric ingress source trigger order unavailable' USING ERRCODE='23514';
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.wp20_metric_ingress_source_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wp20_metric_ingress_source_allowed(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_ingress_source_guard() FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_ingress_source_allowed(TEXT,TEXT,TEXT,TEXT,TEXT) FROM %I',api_role);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid IN ('public.wp20_metric_ingress_source_guard()'::regprocedure,'public.wp20_metric_ingress_source_allowed(TEXT,TEXT,TEXT,TEXT,TEXT)'::regprocedure) AND a.grantee<>p.proowner) THEN
  RAISE EXCEPTION 'unexpected metric ingress source function privileges' USING ERRCODE='23514';
 END IF;
END $$;
-- Stopping ingress does not seal outstanding sources. No source writer fence
-- or complete request universe is claimed, and migration125 remains intact.
COMMIT;
