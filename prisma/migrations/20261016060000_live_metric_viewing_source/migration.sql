-- Private provenance only. No backfill, positive coverage, or collection enablement.
-- New versions get a server-clock ledger epoch. Existing versions stay unknown.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public."LiveMetricViewingEpoch" (
 "vendorId" TEXT NOT NULL, "liveId" TEXT NOT NULL, "versionId" TEXT NOT NULL,
 "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 PRIMARY KEY ("vendorId","liveId","versionId"),
 CONSTRAINT "LiveMetricViewingEpoch_version_fkey" FOREIGN KEY ("vendorId","liveId","versionId")
  REFERENCES public."LiveMetricVersion"("vendorId","liveId",id) ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE TABLE public."LiveMetricViewingSource" (
 id BIGSERIAL PRIMARY KEY,
 "vendorId" TEXT NOT NULL, "liveId" TEXT NOT NULL, "versionId" TEXT NOT NULL,
 "sessionId" TEXT NOT NULL, "registrationId" TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('issued','state','interval','removed')),
 "anchorAt" TIMESTAMPTZ(3) NOT NULL, "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 CONSTRAINT "LiveMetricViewingSource_range_check" CHECK ("anchorAt"<"expiresAt"),
 -- Intentionally no session/registration FK: deletion must retain its tombstone.
 CONSTRAINT "LiveMetricViewingSource_version_fkey" FOREIGN KEY ("vendorId","liveId","versionId")
  REFERENCES public."LiveMetricVersion"("vendorId","liveId",id) ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "LiveMetricViewingSource_scope_session_idx" ON public."LiveMetricViewingSource"("vendorId","liveId","versionId","sessionId");
CREATE INDEX "LiveMetricViewingSource_window_idx" ON public."LiveMetricViewingSource"("vendorId","liveId","versionId",kind,"anchorAt");
-- A deleted issuance cannot be silently re-created under the same session id.
CREATE UNIQUE INDEX "LiveMetricViewingSource_issued_key" ON public."LiveMetricViewingSource"("vendorId","liveId","versionId","sessionId") WHERE kind='issued';

CREATE FUNCTION public.wp20_metric_viewing_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF pg_trigger_depth()<2 OR current_user<>pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid=
    (CASE WHEN TG_TABLE_NAME='LiveMetricViewingEpoch' THEN 'public.wp20_metric_viewing_epoch()'
      ELSE 'public.wp20_metric_viewing_source()' END)::regprocedure)) THEN
   RAISE EXCEPTION 'viewing provenance requires source trigger' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='LiveMetricViewingEpoch' THEN NEW."startedAt":=date_trunc('milliseconds',clock_timestamp());
  ELSE NEW."recordedAt":=date_trunc('milliseconds',clock_timestamp()); END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public."LiveMetricVersion" WHERE id=OLD."versionId"
   AND "vendorId"=OLD."vendorId" AND "liveId"=OLD."liveId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'viewing provenance is immutable' USING ERRCODE='23514';
END $$;


CREATE TRIGGER "LiveMetricViewingEpoch_immutable" BEFORE INSERT OR UPDATE OR DELETE ON public."LiveMetricViewingEpoch"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_viewing_immutable();
CREATE TRIGGER "LiveMetricViewingSource_immutable" BEFORE INSERT OR UPDATE OR DELETE ON public."LiveMetricViewingSource"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_viewing_immutable();
CREATE TRIGGER "LiveMetricViewingEpoch_no_truncate" BEFORE TRUNCATE ON public."LiveMetricViewingEpoch"
 FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();
CREATE TRIGGER "LiveMetricViewingSource_no_truncate" BEFORE TRUNCATE ON public."LiveMetricViewingSource"
 FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();

CREATE FUNCTION public.wp20_metric_viewing_epoch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off AS $$
BEGIN
 IF TG_RELID<>'public."LiveMetricVersion"'::regclass OR TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'invalid viewing epoch source' USING ERRCODE='23514';
 END IF;
 INSERT INTO public."LiveMetricViewingEpoch"("vendorId","liveId","versionId") VALUES(NEW."vendorId",NEW."liveId",NEW.id);
 RETURN NULL;
END $$;
CREATE TRIGGER "LiveMetricVersion_viewing_epoch" AFTER INSERT ON public."LiveMetricVersion"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_viewing_epoch();

CREATE FUNCTION public.wp20_metric_viewing_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off SET timezone='UTC' AS $$
DECLARE s public."LiveMetricSession"%ROWTYPE; event_kind TEXT;
BEGIN
 IF TG_RELID='public."LiveMetricSession"'::regclass THEN
  IF TG_OP='UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN
   -- Only a true no-op is skipped. Progress and future columns are recorded,
   -- without assuming that another trigger emitted an event in this transaction.
   RETURN NULL;
  END IF;
  IF TG_OP='DELETE' THEN s:=OLD; event_kind:='removed';
  ELSE s:=NEW; event_kind:=CASE WHEN TG_OP='INSERT' THEN 'issued' ELSE 'state' END; END IF;
 ELSIF TG_RELID='public."LiveMetricInterval"'::regclass AND TG_OP='INSERT' THEN
  SELECT * INTO STRICT s FROM public."LiveMetricSession" WHERE id=NEW."sessionId"
   AND "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" AND "versionId"=NEW."versionId";
  event_kind:='interval';
 ELSE RAISE EXCEPTION 'invalid viewing event source' USING ERRCODE='23514'; END IF;
 -- Parent version deletion owns whole-scope retention. Do not resurrect it.
 IF NOT EXISTS(SELECT 1 FROM public."LiveMetricVersion" WHERE id=s."versionId"
   AND "vendorId"=s."vendorId" AND "liveId"=s."liveId") THEN RETURN NULL; END IF;
 INSERT INTO public."LiveMetricViewingSource"("vendorId","liveId","versionId","sessionId","registrationId",kind,"anchorAt","expiresAt")
 VALUES(s."vendorId",s."liveId",s."versionId",s.id,s."registrationId",event_kind,s."anchorAt",s."expiresAt");
 RETURN NULL;
END $$;
CREATE TRIGGER "LiveMetricSession_viewing_source" AFTER INSERT OR UPDATE OR DELETE ON public."LiveMetricSession"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_viewing_source();
-- Interval UPDATE/independent DELETE are already prohibited. Session removal
-- emits a tombstone in the same transaction as its interval cascade.
CREATE TRIGGER "LiveMetricInterval_viewing_source" AFTER INSERT ON public."LiveMetricInterval"
 FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_viewing_source();
CREATE TRIGGER "LiveMetricSession_viewing_no_truncate" BEFORE TRUNCATE ON public."LiveMetricSession"
 FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();
CREATE TRIGGER "LiveMetricInterval_viewing_no_truncate" BEFORE TRUNCATE ON public."LiveMetricInterval"
 FOR EACH STATEMENT EXECUTE FUNCTION public.wp20_metric_visit_no_truncate();

-- COUNT is a snapshot revision. Sequence allocation is NOT a commit watermark.
CREATE FUNCTION public.wp20_metric_viewing_revision(vendor_id TEXT,live_id TEXT,version_id TEXT) RETURNS BIGINT
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $$
 SELECT count(*) FROM public."LiveMetricViewingSource" WHERE "vendorId"=vendor_id AND "liveId"=live_id AND "versionId"=version_id
$$;
-- All new provenance reads use the same definer/RLS boundary. An explicitly
-- granted non-owner runtime must not receive silently filtered zero counts.
CREATE FUNCTION public.wp20_metric_viewing_provenance(vendor_id TEXT,live_id TEXT,version_id TEXT,
 window_start TIMESTAMPTZ,window_end TIMESTAMPTZ)
RETURNS TABLE("viewingRevision" BIGINT,"epochStartedAt" TIMESTAMPTZ,"issuedCount" BIGINT,"removedCount" BIGINT)
LANGUAGE plpgsql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=off AS $$
BEGIN
 IF window_start>=window_end THEN
  RAISE EXCEPTION 'invalid viewing provenance window' USING ERRCODE='23514';
 END IF;
 RETURN QUERY
 WITH per_session AS MATERIALIZED (
  SELECT "sessionId",count(*) AS events,bool_or(kind='issued') AS issued,bool_or(kind='removed') AS removed,
   bool_or("anchorAt"<window_end AND "expiresAt">window_start) AS in_window
  FROM public."LiveMetricViewingSource" WHERE "vendorId"=vendor_id AND "liveId"=live_id AND "versionId"=version_id
  GROUP BY "sessionId"
 )
 SELECT coalesce(sum(events),0)::bigint,
  (SELECT "startedAt" FROM public."LiveMetricViewingEpoch" WHERE "vendorId"=vendor_id AND "liveId"=live_id AND "versionId"=version_id),
  count(*) FILTER (WHERE issued AND in_window),count(*) FILTER (WHERE removed AND in_window)
 FROM per_session;
END
$$;
ALTER TABLE public."LiveMetricViewingEpoch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LiveMetricViewingSource" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."LiveMetricViewingEpoch",public."LiveMetricViewingSource" FROM PUBLIC;
REVOKE ALL ON SEQUENCE public."LiveMetricViewingSource_id_seq" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wp20_metric_viewing_immutable(),public.wp20_metric_viewing_epoch(),public.wp20_metric_viewing_source(),public.wp20_metric_viewing_revision(text,text,text),public.wp20_metric_viewing_provenance(text,text,text,timestamptz,timestamptz) FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON public."LiveMetricViewingEpoch",public."LiveMetricViewingSource" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON SEQUENCE public."LiveMetricViewingSource_id_seq" FROM %I',api_role);
   EXECUTE format('REVOKE ALL ON FUNCTION public.wp20_metric_viewing_immutable(),public.wp20_metric_viewing_epoch(),public.wp20_metric_viewing_source(),public.wp20_metric_viewing_revision(text,text,text),public.wp20_metric_viewing_provenance(text,text,text,timestamptz,timestamptz) FROM %I',api_role);
  END IF;
 END LOOP;
END $$;

-- Unknown default privilege grants must fail the atomic migration rather than
-- expose new private objects. Runtime grants are an explicit deployment step.
DO $viewing_acl$ BEGIN
 IF EXISTS (
  SELECT 1 FROM pg_class c
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a
  WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('LiveMetricViewingSource','LiveMetricViewingEpoch','LiveMetricViewingSource_id_seq')
   AND a.grantee<>c.relowner
 ) OR EXISTS (
  SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('wp20_metric_viewing_immutable','wp20_metric_viewing_epoch','wp20_metric_viewing_source','wp20_metric_viewing_revision','wp20_metric_viewing_provenance')
   AND a.grantee<>p.proowner
 ) THEN RAISE EXCEPTION 'unexpected viewing provenance privileges' USING ERRCODE='23514'; END IF;
END $viewing_acl$;
COMMIT;
