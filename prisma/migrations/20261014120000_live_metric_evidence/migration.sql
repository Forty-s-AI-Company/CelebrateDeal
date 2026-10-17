-- CreateTable
CREATE TABLE "LiveMetricVersion" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "videoId" TEXT,
    "mode" TEXT NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "durationMs" INTEGER,
    "collectionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "collectionStartedAt" TIMESTAMPTZ(3),
    "sourceRevision" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LiveMetricVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveMetricVisitor" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "browserHash" CHAR(64) NOT NULL,
    "firstVisitedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveMetricVisitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveMetricRegistration" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "visitorId" TEXT,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveMetricRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveMetricSession" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "admissionSessionId" TEXT NOT NULL,
    "anchorAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSequence" INTEGER NOT NULL DEFAULT -1,
    "finalSequence" INTEGER,
    "lastElapsedMs" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMPTZ(3),
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LiveMetricSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveMetricInterval" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "wallStartAt" TIMESTAMPTZ(3) NOT NULL,
    "wallEndAt" TIMESTAMPTZ(3) NOT NULL,
    "mediaStartMs" INTEGER NOT NULL,
    "mediaEndMs" INTEGER NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveMetricInterval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveMetricReport" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "windowStartAt" TIMESTAMPTZ(3) NOT NULL,
    "windowEndAt" TIMESTAMPTZ(3) NOT NULL,
    "inputRevision" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "cursor" TEXT,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "checkpoint" JSONB,
    "result" JSONB,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LiveMetricReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveMetricVersion_expiresAt_idx" ON "LiveMetricVersion"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveMetricVersion_vendorId_liveId_id_key" ON "LiveMetricVersion"("vendorId", "liveId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LiveMetricVersion_vendorId_liveId_mode_fingerprint_key" ON "LiveMetricVersion"("vendorId", "liveId", "mode", "fingerprint");

-- CreateIndex
CREATE INDEX "LiveMetricVisitor_scope_visit_idx" ON "LiveMetricVisitor"("vendorId", "liveId", "versionId", "firstVisitedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveMetricVisitor_scope_id_key" ON "LiveMetricVisitor"("vendorId", "liveId", "versionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LiveMetricVisitor_scope_browser_key" ON "LiveMetricVisitor"("vendorId", "liveId", "versionId", "browserHash");

-- CreateIndex
CREATE INDEX "LiveMetricRegistration_scope_verified_idx" ON "LiveMetricRegistration"("vendorId", "liveId", "versionId", "verifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveMetricRegistration_scope_id_key" ON "LiveMetricRegistration"("vendorId", "liveId", "versionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LiveMetricRegistration_scope_submission_key" ON "LiveMetricRegistration"("vendorId", "liveId", "versionId", "submissionId");

-- CreateIndex
CREATE INDEX "LiveMetricSession_scope_registration_idx" ON "LiveMetricSession"("vendorId", "liveId", "versionId", "registrationId");

-- CreateIndex
CREATE INDEX "LiveMetricSession_expiresAt_idx" ON "LiveMetricSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveMetricSession_scope_id_key" ON "LiveMetricSession"("vendorId", "liveId", "versionId", "id");

-- CreateIndex
CREATE INDEX "LiveMetricInterval_scope_wall_idx" ON "LiveMetricInterval"("vendorId", "liveId", "versionId", "wallEndAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveMetricInterval_sessionId_sequence_key" ON "LiveMetricInterval"("sessionId", "sequence");

-- CreateIndex
CREATE INDEX "LiveMetricReport_claim_idx" ON "LiveMetricReport"("vendorId", "status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "LiveMetricReport_expiresAt_idx" ON "LiveMetricReport"("expiresAt");

-- CreateIndex
CREATE INDEX "LiveMetricReport_scope_window_revision_key" ON "LiveMetricReport"("vendorId", "liveId", "versionId", "windowStartAt", "windowEndAt", "inputRevision");

-- CreateIndex
-- No FK to the ephemeral admission lease: releasing playback must preserve history.

-- AddForeignKey
ALTER TABLE "LiveMetricVersion" ADD CONSTRAINT "LiveMetricVersion_vendorId_liveId_fkey" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey

-- AddForeignKey
ALTER TABLE "LiveMetricVisitor" ADD CONSTRAINT "LiveMetricVisitor_vendorId_liveId_versionId_fkey" FOREIGN KEY ("vendorId", "liveId", "versionId") REFERENCES "LiveMetricVersion"("vendorId", "liveId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveMetricRegistration" ADD CONSTRAINT "LiveMetricRegistration_vendorId_liveId_versionId_fkey" FOREIGN KEY ("vendorId", "liveId", "versionId") REFERENCES "LiveMetricVersion"("vendorId", "liveId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveMetricRegistration" ADD CONSTRAINT "LiveMetricRegistration_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FormSubmission"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "LiveMetricRegistration" ADD CONSTRAINT "LiveMetricRegistration_vendorId_liveId_versionId_visitorId_fkey" FOREIGN KEY ("vendorId", "liveId", "versionId", "visitorId") REFERENCES "LiveMetricVisitor"("vendorId", "liveId", "versionId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveMetricSession" ADD CONSTRAINT "LiveMetricSession_vendorId_liveId_versionId_fkey" FOREIGN KEY ("vendorId", "liveId", "versionId") REFERENCES "LiveMetricVersion"("vendorId", "liveId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveMetricSession" ADD CONSTRAINT "LiveMetricSession_vendorId_liveId_versionId_registrationId_fkey" FOREIGN KEY ("vendorId", "liveId", "versionId", "registrationId") REFERENCES "LiveMetricRegistration"("vendorId", "liveId", "versionId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey

-- AddForeignKey
ALTER TABLE "LiveMetricInterval" ADD CONSTRAINT "LiveMetricInterval_vendorId_liveId_versionId_sessionId_fkey" FOREIGN KEY ("vendorId", "liveId", "versionId", "sessionId") REFERENCES "LiveMetricSession"("vendorId", "liveId", "versionId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveMetricReport" ADD CONSTRAINT "LiveMetricReport_vendorId_liveId_versionId_fkey" FOREIGN KEY ("vendorId", "liveId", "versionId") REFERENCES "LiveMetricVersion"("vendorId", "liveId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Evidence invariants are enforced in PostgreSQL as well as the ingestion API.
-- No legacy analytics are copied and collection remains disabled by default.
ALTER TABLE "LiveMetricVersion" ADD CONSTRAINT "LiveMetricVersion_values_check" CHECK (
  "mode" IN ('live','replay') AND "fingerprint" ~ '^[0-9a-f]{64}$'
  AND ("durationMs" IS NULL OR "durationMs" > 0) AND "sourceRevision" >= 0
  AND "expiresAt" > "createdAt"
  AND (NOT "collectionEnabled" OR "collectionStartedAt" IS NOT NULL)
  AND ("collectionStartedAt" IS NULL OR "collectionStartedAt" < "expiresAt")
);
ALTER TABLE "LiveMetricVisitor" ADD CONSTRAINT "LiveMetricVisitor_hash_check"
  CHECK ("browserHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "LiveMetricSession" ADD CONSTRAINT "LiveMetricSession_state_check" CHECK (
  "lastSequence" >= -1 AND "lastElapsedMs" >= 0 AND "expiresAt" > "anchorAt"
  AND ("closedAt" IS NULL OR "closedAt" >= "anchorAt")
  AND ("finalSequence" IS NULL OR "finalSequence" >= -1)
  AND (NOT "complete" OR ("closedAt" IS NOT NULL AND "finalSequence" IS NOT NULL AND "finalSequence" = "lastSequence"))
);
ALTER TABLE "LiveMetricInterval" ADD CONSTRAINT "LiveMetricInterval_values_check" CHECK (
  "sequence" >= 0 AND "payloadHash" ~ '^[0-9a-f]{64}$'
  AND "mediaStartMs" >= 0 AND "mediaEndMs" > "mediaStartMs"
  AND "wallEndAt" > "wallStartAt"
  AND "wallEndAt" - "wallStartAt" <= INTERVAL '5 seconds'
  AND "receivedAt" >= "wallEndAt"
  AND "mediaEndMs" - "mediaStartMs" <= EXTRACT(EPOCH FROM ("wallEndAt" - "wallStartAt")) * 4000 + 1
  AND "mediaEndMs" - "mediaStartMs" >= EXTRACT(EPOCH FROM ("wallEndAt" - "wallStartAt")) * 250 - 1
);
ALTER TABLE "LiveMetricReport" ADD CONSTRAINT "LiveMetricReport_state_check" CHECK (
  "windowStartAt" < "windowEndAt" AND "inputRevision" >= 0
  AND "processedCount" >= 0 AND "attempts" >= 0 AND "expiresAt" > "createdAt"
  AND "status" IN ('queued','running','ready','failed','stale')
  AND (("status" = 'running' AND "leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    OR ("status" <> 'running' AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL))
  AND ("status" <> 'ready' OR ("result" IS NOT NULL AND "finishedAt" IS NOT NULL))
);

CREATE FUNCTION public.wp20_metric_version_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'metric writes require read committed isolation' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    NEW."sourceRevision" := 0;
    IF NOT EXISTS (SELECT 1 FROM public."Live" l WHERE l."id"=NEW."liveId" AND l."vendorId"=NEW."vendorId"
      AND l."videoId" IS NOT DISTINCT FROM NEW."videoId"
      AND (NEW."videoId" IS NULL OR EXISTS (SELECT 1 FROM public."Video" v WHERE v."id"=NEW."videoId" AND v."vendorId"=NEW."vendorId"))) THEN
      RAISE EXCEPTION 'metric source must belong to its live' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."id", NEW."vendorId", NEW."liveId", NEW."videoId", NEW."mode", NEW."fingerprint", NEW."durationMs")
    IS DISTINCT FROM (OLD."id", OLD."vendorId", OLD."liveId", OLD."videoId", OLD."mode", OLD."fingerprint", OLD."durationMs") THEN
    RAISE EXCEPTION 'metric version identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."collectionStartedAt" IS NOT NULL AND NEW."collectionStartedAt" IS DISTINCT FROM OLD."collectionStartedAt" THEN
    RAISE EXCEPTION 'metric collection origin is immutable' USING ERRCODE = '23514';
  END IF;
  NEW."sourceRevision" := OLD."sourceRevision" + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricVersion_revision" BEFORE INSERT OR UPDATE ON "LiveMetricVersion"
  FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_version_update();

CREATE FUNCTION public.wp20_metric_report_invalidate() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
BEGIN
  UPDATE public."LiveMetricReport" SET "status" = 'stale', "result" = NULL,
    "leaseOwner" = NULL, "leaseExpiresAt" = NULL
  WHERE "vendorId" = NEW."vendorId" AND "liveId" = NEW."liveId" AND "versionId" = NEW."id"
    AND "inputRevision" <> NEW."sourceRevision" AND "status" <> 'stale';
  RETURN NULL;
END $$;
CREATE TRIGGER "LiveMetricVersion_invalidate_reports" AFTER UPDATE ON "LiveMetricVersion"
  FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_report_invalidate();

CREATE FUNCTION public.wp20_metric_scope_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
BEGIN
  IF (NEW."id", NEW."vendorId", NEW."liveId", NEW."versionId")
    IS DISTINCT FROM (OLD."id", OLD."vendorId", OLD."liveId", OLD."versionId") THEN
    RAISE EXCEPTION 'metric evidence scope is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- Ordinary evidence does not rewrite a shared version counter. It invalidates
-- only reports whose input window overlaps the changed facts. The shared lock
-- serializes report creation against inserts without serializing viewers.
CREATE FUNCTION public.wp20_metric_evidence_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE fact JSONB; affected_start TIMESTAMPTZ; affected_end TIMESTAMPTZ;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'metric writes require read committed isolation' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='LiveMetricSession' AND TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-'lastSequence'-'lastElapsedMs')=(to_jsonb(OLD)-'lastSequence'-'lastElapsedMs') THEN RETURN NULL; END IF;
  END IF;
  fact := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_TABLE_NAME='LiveMetricInterval' THEN
    affected_start := (fact->>'wallStartAt')::timestamp;
    affected_end := (fact->>'wallEndAt')::timestamp;
  ELSIF TG_TABLE_NAME='LiveMetricVisitor' THEN
    affected_start := (fact->>'firstVisitedAt')::timestamp;
    affected_end := affected_start+INTERVAL '1 millisecond';
  ELSIF TG_TABLE_NAME='LiveMetricRegistration' THEN
    affected_start := (fact->>'verifiedAt')::timestamp;
    affected_end := affected_start+INTERVAL '1 millisecond';
  ELSE
    affected_start := (fact->>'anchorAt')::timestamp;
    affected_end := (fact->>'expiresAt')::timestamp;
  END IF;
  PERFORM 1 FROM public."LiveMetricVersion" WHERE id=fact->>'versionId'
    AND "vendorId"=fact->>'vendorId' AND "liveId"=fact->>'liveId' FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public."LiveMetricReport" SET status='stale',result=NULL,"leaseOwner"=NULL,"leaseExpiresAt"=NULL
    WHERE "versionId"=fact->>'versionId' AND "vendorId"=fact->>'vendorId' AND "liveId"=fact->>'liveId'
      AND "windowStartAt"<affected_end AND "windowEndAt">affected_start AND status<>'stale';
  RETURN NULL;
END $$;
DO $$ DECLARE metric_table TEXT; BEGIN
  FOREACH metric_table IN ARRAY ARRAY['LiveMetricVisitor','LiveMetricRegistration','LiveMetricSession','LiveMetricInterval'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_scope_update()', metric_table || '_scope_immutable', metric_table);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_evidence_changed()', metric_table || '_revision', metric_table);
  END LOOP;
END $$;

CREATE FUNCTION public.wp20_metric_registration_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'metric writes require read committed isolation' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public."Live" WHERE id=NEW."liveId" AND "vendorId"=NEW."vendorId" FOR SHARE;
  PERFORM 1 FROM public."FormSubmission" WHERE id=NEW."submissionId" FOR SHARE;
  PERFORM 1 FROM public."LiveMetricVersion" WHERE id=NEW."versionId"
    AND "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" FOR SHARE;
  IF TG_OP='UPDATE' AND (NEW."submissionId",NEW."visitorId",NEW."verifiedAt")
    IS DISTINCT FROM (OLD."submissionId",OLD."visitorId",OLD."verifiedAt") THEN
    RAISE EXCEPTION 'metric registration identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."FormSubmission" s
    JOIN public."RegistrationForm" f ON f."id" = s."formId"
    JOIN public."Live" l ON l."id" = s."liveId" AND l."vendorId" = f."vendorId"
    WHERE s."id" = NEW."submissionId" AND s."liveId" = NEW."liveId" AND f."vendorId" = NEW."vendorId"
      AND s."verificationStatus" = 'VERIFIED' AND s."verifiedAt" = NEW."verifiedAt"
      AND l."formId" = s."formId"
  ) THEN
    RAISE EXCEPTION 'verified metric registration required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricRegistration_verified" BEFORE INSERT OR UPDATE ON "LiveMetricRegistration"
  FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_registration_guard();

CREATE FUNCTION public.wp20_metric_interval_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE current_session public."LiveMetricSession"%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'metric writes require read committed isolation' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN
    -- Parent cascade is allowed; deleting individual evidence would punch a
    -- hole in a session that has already proved its contiguous completion.
    IF EXISTS (SELECT 1 FROM public."LiveMetricSession" WHERE id=OLD."sessionId") THEN
      RAISE EXCEPTION 'metric interval deletion requires parent cascade' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'metric interval is append only' USING ERRCODE = '23514';
  END IF;
  -- Lock mutable authorization sources before the metric session. Revocation,
  -- release and source changes either precede this insert or wait for it.
  SELECT * INTO current_session FROM public."LiveMetricSession" WHERE "id"=NEW."sessionId";
  IF NOT FOUND THEN RAISE EXCEPTION 'metric session missing' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public."Live" WHERE id=NEW."liveId" AND "vendorId"=NEW."vendorId" FOR SHARE;
  PERFORM 1 FROM public."FormSubmission" f JOIN public."LiveMetricRegistration" r ON r."submissionId"=f.id
    WHERE r.id=current_session."registrationId" FOR SHARE OF f;
  PERFORM 1 FROM public."LiveViewerSession" WHERE id=current_session."admissionSessionId" FOR SHARE;
  PERFORM 1 FROM public."LiveMetricVersion" WHERE id=NEW."versionId"
    AND "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" FOR SHARE;
  SELECT * INTO current_session FROM public."LiveMetricSession" WHERE "id"=NEW."sessionId" FOR UPDATE;
  -- Check expiry after any lock wait, against the database-owned receipt time.
  NEW."receivedAt" := clock_timestamp();
  IF NOT FOUND OR NEW."sequence"<>current_session."lastSequence"+1
    OR (current_session."finalSequence" IS NOT NULL AND NEW."sequence">current_session."finalSequence")
    OR NEW."wallStartAt"<current_session."anchorAt" + current_session."lastElapsedMs" * INTERVAL '1 millisecond' THEN
    RAISE EXCEPTION 'metric intervals must be contiguous and nonoverlapping' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."LiveMetricSession" s
    JOIN public."LiveMetricVersion" v ON v."id" = s."versionId" AND v."vendorId" = s."vendorId" AND v."liveId" = s."liveId"
    JOIN public."Live" l ON l."id"=v."liveId" AND l."vendorId"=v."vendorId" AND l."videoId" IS NOT DISTINCT FROM v."videoId"
    JOIN public."LiveMetricRegistration" r ON r."id" = s."registrationId" AND r."vendorId" = s."vendorId" AND r."liveId" = s."liveId" AND r."versionId" = s."versionId"
    JOIN public."FormSubmission" f ON f."id" = r."submissionId" AND f."liveId" = r."liveId"
    JOIN public."LiveViewerSession" a ON a."id" = s."admissionSessionId" AND a."vendorId" = s."vendorId" AND a."liveId" = s."liveId"
    WHERE s."id" = NEW."sessionId" AND s."vendorId" = NEW."vendorId" AND s."liveId" = NEW."liveId" AND s."versionId" = NEW."versionId"
      AND v."collectionEnabled" AND NEW."wallStartAt" >= v."collectionStartedAt" AND NEW."receivedAt" < v."expiresAt"
      AND s."closedAt" IS NULL AND NOT s."complete" AND NEW."wallStartAt" >= s."anchorAt"
      AND NEW."wallStartAt" >= r."verifiedAt" AND NEW."receivedAt" < s."expiresAt" AND NEW."receivedAt" < a."expiresAt"
      AND f."verificationStatus" = 'VERIFIED' AND f."verifiedAt" = r."verifiedAt" AND l."formId"=f."formId"
      AND (v."durationMs" IS NULL OR NEW."mediaEndMs" <= v."durationMs")
  ) THEN
    RAISE EXCEPTION 'metric interval scope or lifetime invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricInterval_guard" BEFORE INSERT OR UPDATE OR DELETE ON "LiveMetricInterval"
  FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_interval_guard();

-- Advance progress only after an interval actually exists in the transaction.
CREATE FUNCTION public.wp20_metric_interval_progress() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
BEGIN
  UPDATE public."LiveMetricSession" SET "lastSequence"=NEW."sequence",
    "lastElapsedMs"=EXTRACT(EPOCH FROM (NEW."wallEndAt"-"anchorAt"))*1000
  WHERE "id"=NEW."sessionId";
  RETURN NULL;
END $$;
CREATE TRIGGER "LiveMetricInterval_progress" AFTER INSERT ON "LiveMetricInterval"
  FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_interval_progress();

-- Keep the existing server-only Data API contract for every newly added table.
DO $$ DECLARE metric_table TEXT; api_role TEXT; function_name TEXT; BEGIN
  FOREACH metric_table IN ARRAY ARRAY['LiveMetricVersion','LiveMetricVisitor','LiveMetricRegistration','LiveMetricSession','LiveMetricInterval','LiveMetricReport'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', metric_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', metric_table);
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=api_role) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', metric_table, api_role);
      END IF;
    END LOOP;
  END LOOP;
END $$;

CREATE FUNCTION public.wp20_metric_visitor_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'metric writes require read committed isolation' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public."LiveMetricVersion" WHERE id=NEW."versionId"
    AND "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" FOR SHARE;
  IF TG_OP='UPDATE' AND (NEW."browserHash",NEW."firstVisitedAt") IS DISTINCT FROM (OLD."browserHash",OLD."firstVisitedAt") THEN
    RAISE EXCEPTION 'metric browser identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."LiveMetricVersion" v
    WHERE v."id"=NEW."versionId" AND v."vendorId"=NEW."vendorId" AND v."liveId"=NEW."liveId"
      AND v."collectionEnabled" AND NEW."firstVisitedAt">=v."collectionStartedAt" AND NEW."firstVisitedAt"<v."expiresAt"
      AND NEW."firstVisitedAt"<=clock_timestamp() AND v."expiresAt">clock_timestamp()) THEN
    RAISE EXCEPTION 'metric visitor collection disabled or outside lifetime' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricVisitor_collection" BEFORE INSERT OR UPDATE ON "LiveMetricVisitor"
  FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_visitor_guard();

CREATE FUNCTION public.wp20_metric_session_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'metric writes require read committed isolation' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    PERFORM 1 FROM public."Live" WHERE id=NEW."liveId" AND "vendorId"=NEW."vendorId" FOR SHARE;
    PERFORM 1 FROM public."FormSubmission" f JOIN public."LiveMetricRegistration" r ON r."submissionId"=f.id
      WHERE r.id=NEW."registrationId" FOR SHARE OF f;
    PERFORM 1 FROM public."LiveViewerSession" WHERE id=NEW."admissionSessionId" FOR SHARE;
    PERFORM 1 FROM public."LiveMetricVersion" WHERE id=NEW."versionId"
      AND "vendorId"=NEW."vendorId" AND "liveId"=NEW."liveId" FOR SHARE;
    NEW."createdAt" := clock_timestamp();
    IF NEW."lastSequence"<>-1 OR NEW."lastElapsedMs"<>0 OR NEW."finalSequence" IS NOT NULL
      OR NEW."complete" OR NEW."closedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'new metric session must have empty progress' USING ERRCODE='23514';
    END IF;
    IF NEW."expiresAt"<=NEW."createdAt" OR NEW."anchorAt">NEW."createdAt" THEN
      RAISE EXCEPTION 'metric session outside server lifetime' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='INSERT' AND NOT EXISTS (
    SELECT 1 FROM public."LiveViewerSession" a
    JOIN public."LiveMetricRegistration" r ON r."vendorId"=a."vendorId" AND r."liveId"=a."liveId"
    JOIN public."LiveMetricVersion" v ON v."id"=r."versionId" AND v."vendorId"=r."vendorId" AND v."liveId"=r."liveId"
    JOIN public."FormSubmission" f ON f.id=r."submissionId" AND f."liveId"=r."liveId"
      AND f."verificationStatus"='VERIFIED' AND f."verifiedAt"=r."verifiedAt"
    JOIN public."Live" l ON l.id=v."liveId" AND l."vendorId"=v."vendorId" AND l."formId"=f."formId"
      AND l."videoId" IS NOT DISTINCT FROM v."videoId"
    WHERE a."id"=NEW."admissionSessionId" AND a."vendorId"=NEW."vendorId" AND a."liveId"=NEW."liveId"
      AND r."id"=NEW."registrationId" AND r."versionId"=NEW."versionId"
      AND NEW."anchorAt">=r."verifiedAt" AND NEW."anchorAt">=a."createdAt" AND a."expiresAt">NEW."createdAt"
      AND v."collectionEnabled" AND NEW."anchorAt">=v."collectionStartedAt" AND NEW."expiresAt"<=v."expiresAt"
  ) THEN
    RAISE EXCEPTION 'active scoped metric admission required' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW."lastSequence",NEW."lastElapsedMs") IS DISTINCT FROM (OLD."lastSequence",OLD."lastElapsedMs")
      AND NOT EXISTS (SELECT 1 FROM public."LiveMetricInterval" i WHERE i."sessionId"=NEW."id"
        AND i."sequence"=NEW."lastSequence" AND EXTRACT(EPOCH FROM (i."wallEndAt"-NEW."anchorAt"))*1000=NEW."lastElapsedMs") THEN
      RAISE EXCEPTION 'metric progress requires stored interval' USING ERRCODE='23514';
    END IF;
    IF NEW."complete" AND (NEW."closedAt">clock_timestamp()
      OR NEW."closedAt"<NEW."anchorAt"+NEW."lastElapsedMs"*INTERVAL '1 millisecond'
      OR (SELECT count(*) FROM public."LiveMetricInterval" i WHERE i."sessionId"=NEW."id")<>NEW."lastSequence"+1) THEN
      RAISE EXCEPTION 'metric completion requires all stored intervals' USING ERRCODE='23514';
    END IF;
    IF (NEW."registrationId",NEW."admissionSessionId",NEW."anchorAt")
      IS DISTINCT FROM (OLD."registrationId",OLD."admissionSessionId",OLD."anchorAt")
      OR NEW."lastSequence"<OLD."lastSequence" OR NEW."lastElapsedMs"<OLD."lastElapsedMs"
      OR (OLD."closedAt" IS NOT NULL AND NEW."closedAt" IS DISTINCT FROM OLD."closedAt")
      OR (OLD."complete" AND NOT NEW."complete")
      OR (OLD."finalSequence" IS NOT NULL AND NEW."finalSequence" IS DISTINCT FROM OLD."finalSequence") THEN
      RAISE EXCEPTION 'metric session identity or progress is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "LiveMetricSession_progress" BEFORE INSERT OR UPDATE ON "LiveMetricSession"
  FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_session_guard();

CREATE FUNCTION public.wp20_metric_report_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE current_revision BIGINT;
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
  IF NEW."status" IN ('queued','running','ready') THEN
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
CREATE TRIGGER "LiveMetricReport_current_input" BEFORE INSERT OR UPDATE ON "LiveMetricReport"
  FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_report_guard();

DO $$ DECLARE function_name TEXT; api_role TEXT; BEGIN
  FOREACH function_name IN ARRAY ARRAY['wp20_metric_version_update','wp20_metric_report_invalidate','wp20_metric_scope_update','wp20_metric_evidence_changed','wp20_metric_registration_guard','wp20_metric_interval_guard','wp20_metric_visitor_guard','wp20_metric_session_guard','wp20_metric_report_guard','wp20_metric_interval_progress'] LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.%I() FROM PUBLIC', function_name);
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=api_role) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.%I() FROM %I', function_name,api_role);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Worker entry points lock the version before the report, matching ingestion's
-- version -> report invalidation order. The API must not claim with raw UPDATE.
CREATE FUNCTION public.wp20_metric_report_claim(
  vendor_id TEXT, live_id TEXT, version_id TEXT, report_id TEXT,
  worker_id TEXT, lease_until TIMESTAMPTZ(3)
) RETURNS INTEGER LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE changed INTEGER; previous_writer TEXT;
BEGIN
  IF worker_id IS NULL OR length(worker_id)=0 OR lease_until<=clock_timestamp()
    OR lease_until>clock_timestamp()+INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'invalid metric worker lease' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public."LiveMetricVersion"
    WHERE id=version_id AND "vendorId"=vendor_id AND "liveId"=live_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
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
CREATE FUNCTION public.wp20_metric_report_finish(
  vendor_id TEXT, live_id TEXT, version_id TEXT, report_id TEXT,
  worker_id TEXT, report_result JSONB
) RETURNS INTEGER LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE changed INTEGER; previous_writer TEXT;
BEGIN
  IF report_result IS NULL THEN RAISE EXCEPTION 'metric result required' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public."LiveMetricVersion"
    WHERE id=version_id AND "vendorId"=vendor_id AND "liveId"=live_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
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
DO $$ DECLARE signature TEXT; api_role TEXT; BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.wp20_metric_report_claim(text,text,text,text,text,timestamp with time zone)',
    'public.wp20_metric_report_finish(text,text,text,text,text,jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC', signature);
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=api_role) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I', signature,api_role);
      END IF;
    END LOOP;
  END LOOP;
END $$;

CREATE UNIQUE INDEX "LiveMetricReport_active_window_key" ON "LiveMetricReport"
  ("vendorId","liveId","versionId","windowStartAt","windowEndAt","inputRevision")
  WHERE status IN ('queued','running','ready');

CREATE FUNCTION public.wp20_metric_report_create(
  vendor_id TEXT, live_id TEXT, version_id TEXT, report_id TEXT,
  window_start TIMESTAMPTZ(3), window_end TIMESTAMPTZ(3), input_revision BIGINT, expires_at TIMESTAMPTZ(3)
) RETURNS INTEGER LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE previous_writer TEXT;
BEGIN
  PERFORM 1 FROM public."LiveMetricVersion" WHERE id=version_id AND "vendorId"=vendor_id AND "liveId"=live_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'metric version missing' USING ERRCODE='23514'; END IF;
  IF window_end>clock_timestamp() THEN RAISE EXCEPTION 'metric report window must have ended' USING ERRCODE='23514'; END IF;
  previous_writer := current_setting('wp20.report_writer',true);
  PERFORM set_config('wp20.report_writer','create',true);
  INSERT INTO public."LiveMetricReport" (id,"vendorId","liveId","versionId","windowStartAt","windowEndAt","inputRevision","expiresAt")
    VALUES (report_id,vendor_id,live_id,version_id,window_start,window_end,input_revision,expires_at);
  PERFORM set_config('wp20.report_writer',coalesce(previous_writer,''),true);
  RETURN 1;
END $$;
REVOKE ALL PRIVILEGES ON FUNCTION public.wp20_metric_report_create(text,text,text,text,timestamptz,timestamptz,bigint,timestamptz) FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.wp20_metric_report_create(text,text,text,text,timestamptz,timestamptz,bigint,timestamptz) FROM %I',api_role);
    END IF;
  END LOOP;
END $$;

-- External authorization/source changes invalidate cached inputs. Historical
-- evidence stays append-only; release does not delete past viewing facts.
CREATE FUNCTION public.wp20_metric_source_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE version_id TEXT; affected_scope RECORD;
BEGIN
  IF TG_TABLE_NAME='FormSubmission' THEN
    IF (NEW."verificationStatus",NEW."verifiedAt",NEW."liveId",NEW."formId")
      IS NOT DISTINCT FROM (OLD."verificationStatus",OLD."verifiedAt",OLD."liveId",OLD."formId") THEN RETURN NULL; END IF;
    FOR affected_scope IN SELECT DISTINCT r."vendorId",r."liveId",r."versionId",r."verifiedAt" FROM public."LiveMetricRegistration" r
      WHERE r."submissionId"=OLD.id ORDER BY r."versionId",r."vendorId",r."liveId",r."verifiedAt" LOOP
      PERFORM 1 FROM public."LiveMetricVersion" WHERE id=affected_scope."versionId"
        AND "vendorId"=affected_scope."vendorId" AND "liveId"=affected_scope."liveId" FOR SHARE;
      UPDATE public."LiveMetricReport" SET status='stale',result=NULL,"leaseOwner"=NULL,"leaseExpiresAt"=NULL
        WHERE "vendorId"=affected_scope."vendorId" AND "liveId"=affected_scope."liveId" AND "versionId"=affected_scope."versionId"
          AND "windowStartAt"<=affected_scope."verifiedAt" AND "windowEndAt">affected_scope."verifiedAt" AND status<>'stale';
    END LOOP;
  ELSIF TG_TABLE_NAME='Live' THEN
    IF (NEW."videoId",NEW."formId") IS NOT DISTINCT FROM (OLD."videoId",OLD."formId") THEN RETURN NULL; END IF;
    FOR version_id IN SELECT v.id FROM public."LiveMetricVersion" v
      WHERE v."liveId"=OLD.id AND v."vendorId"=OLD."vendorId" ORDER BY v.id LOOP
      UPDATE public."LiveMetricVersion" SET "sourceRevision"="sourceRevision"+1 WHERE id=version_id;
    END LOOP;
  ELSE
    -- Normal release removes a short-lived authorization lease, not historical
    -- accepted evidence. It must not invalidate unrelated completed windows.
    IF TG_OP='DELETE' THEN RETURN NULL; END IF;
    IF NEW."expiresAt">=OLD."expiresAt" THEN RETURN NULL; END IF;
    FOR affected_scope IN SELECT DISTINCT s."vendorId",s."liveId",s."versionId" FROM public."LiveMetricSession" s
      WHERE s."admissionSessionId"=OLD.id ORDER BY s."versionId",s."vendorId",s."liveId" LOOP
      PERFORM 1 FROM public."LiveMetricVersion" WHERE id=affected_scope."versionId"
        AND "vendorId"=affected_scope."vendorId" AND "liveId"=affected_scope."liveId" FOR SHARE;
      UPDATE public."LiveMetricReport" SET status='stale',result=NULL,"leaseOwner"=NULL,"leaseExpiresAt"=NULL
        WHERE "vendorId"=affected_scope."vendorId" AND "liveId"=affected_scope."liveId" AND "versionId"=affected_scope."versionId"
          AND "windowStartAt"<OLD."expiresAt" AND "windowEndAt">NEW."expiresAt" AND status<>'stale';
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "FormSubmission_metric_source" AFTER UPDATE ON "FormSubmission"
  FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_source_changed();
CREATE TRIGGER "Live_metric_source" AFTER UPDATE ON "Live"
  FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_source_changed();
CREATE TRIGGER "LiveViewerSession_metric_source" AFTER UPDATE OR DELETE ON "LiveViewerSession"
  FOR EACH ROW EXECUTE FUNCTION public.wp20_metric_source_changed();
REVOKE ALL PRIVILEGES ON FUNCTION public.wp20_metric_source_changed() FROM PUBLIC;
DO $$ DECLARE api_role TEXT; BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=api_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.wp20_metric_source_changed() FROM %I',api_role);
    END IF;
  END LOOP;
END $$;

CREATE INDEX "LiveMetricRegistration_submissionId_idx" ON "LiveMetricRegistration"("submissionId");
CREATE INDEX "LiveMetricSession_admissionSessionId_idx" ON "LiveMetricSession"("admissionSessionId");
