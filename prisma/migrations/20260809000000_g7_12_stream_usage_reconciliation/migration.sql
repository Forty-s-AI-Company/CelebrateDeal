-- G7-12: provider-report reconciliation stays separate from the immutable
-- server usage ledger. Reports are represented only by an attested SHA-256
-- digest and an optional sanitized reference; raw payloads/account IDs are not stored.

CREATE TYPE "StreamUsageReconciliationStatus" AS ENUM ('MATCHED', 'MISMATCH', 'RESOLVED');
CREATE TYPE "StreamUsageReconciliationResolution" AS ENUM ('ACCEPT_INTERNAL', 'ACCEPT_PROVIDER', 'ESCALATED');
CREATE TYPE "StreamUsageReconciliationEvidenceKind" AS ENUM ('ADMIN_ATTESTED_DIGEST');
CREATE TYPE "StreamOperationsAlertType" AS ENUM ('QUOTA_WARNING', 'QUOTA_EXHAUSTED', 'PROVIDER_DISCREPANCY');
CREATE TYPE "StreamOperationsAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "StreamOperationsAlertSeverity" AS ENUM ('WARNING', 'CRITICAL');

CREATE TABLE "StreamUsageReconciliation" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "monthKey" TEXT NOT NULL,
  "sourceDigest" TEXT NOT NULL,
  "sourceReference" TEXT,
  "providerWatchMinutes" INTEGER NOT NULL,
  "providerStorageMinutes" INTEGER,
  "internalWatchSeconds" INTEGER NOT NULL,
  "internalWatchMinutes" INTEGER NOT NULL,
  "differenceMinutes" INTEGER NOT NULL,
  "status" "StreamUsageReconciliationStatus" NOT NULL,
  "evidenceKind" "StreamUsageReconciliationEvidenceKind" NOT NULL DEFAULT 'ADMIN_ATTESTED_DIGEST',
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "createdByActorId" TEXT NOT NULL,
  "createdByActorLabel" TEXT NOT NULL,
  "resolution" "StreamUsageReconciliationResolution",
  "resolutionNote" TEXT,
  "resolvedByActorId" TEXT,
  "resolvedByActorLabel" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StreamUsageReconciliation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StreamUsageReconciliation_month_check" CHECK ("monthKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "StreamUsageReconciliation_provider_check" CHECK ("provider" ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
  CONSTRAINT "StreamUsageReconciliation_digest_check" CHECK ("sourceDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "StreamUsageReconciliation_source_reference_check" CHECK (
    "sourceReference" IS NULL OR (
      length(btrim("sourceReference")) BETWEEN 1 AND 120
      AND "sourceReference" ~ '^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,119}$'
    )
  ),
  CONSTRAINT "StreamUsageReconciliation_totals_check" CHECK (
    "providerWatchMinutes" >= 0
    AND ("providerStorageMinutes" IS NULL OR "providerStorageMinutes" >= 0)
    AND "internalWatchSeconds" >= 0
    AND "internalWatchMinutes" >= 0
  ),
  CONSTRAINT "StreamUsageReconciliation_lifecycle_check" CHECK (
    (
      "status" IN ('MATCHED', 'MISMATCH')
      AND "resolution" IS NULL
      AND "resolutionNote" IS NULL
      AND "resolvedByActorId" IS NULL
      AND "resolvedByActorLabel" IS NULL
      AND "resolvedAt" IS NULL
    )
    OR (
      "status" = 'RESOLVED'
      AND "resolution" IS NOT NULL
      AND length(btrim("resolutionNote")) BETWEEN 10 AND 500
      AND length(btrim("resolvedByActorId")) > 0
      AND length(btrim("resolvedByActorLabel")) > 0
      AND "resolvedAt" IS NOT NULL
    )
  )
);

CREATE TABLE "StreamOperationsAlert" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "type" "StreamOperationsAlertType" NOT NULL,
  "status" "StreamOperationsAlertStatus" NOT NULL DEFAULT 'OPEN',
  "dedupKey" TEXT NOT NULL,
  "provider" TEXT,
  "monthKey" TEXT NOT NULL,
  "severity" "StreamOperationsAlertSeverity" NOT NULL,
  "message" TEXT NOT NULL,
  "reconciliationId" TEXT,
  "metadata" JSONB,
  "acknowledgedByActorId" TEXT,
  "acknowledgedByActorLabel" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedByActorId" TEXT,
  "resolvedByActorLabel" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StreamOperationsAlert_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StreamOperationsAlert_dedup_check" CHECK (length(btrim("dedupKey")) BETWEEN 1 AND 200),
  CONSTRAINT "StreamOperationsAlert_month_check" CHECK ("monthKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "StreamOperationsAlert_provider_check" CHECK ("provider" IS NULL OR "provider" ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
  CONSTRAINT "StreamOperationsAlert_message_check" CHECK (length(btrim("message")) BETWEEN 1 AND 1000),
  CONSTRAINT "StreamOperationsAlert_metadata_check" CHECK ("metadata" IS NULL OR jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "StreamOperationsAlert_lifecycle_check" CHECK (
    (
      "status" = 'OPEN'
      AND "acknowledgedByActorId" IS NULL
      AND "acknowledgedByActorLabel" IS NULL
      AND "acknowledgedAt" IS NULL
      AND "resolvedByActorId" IS NULL
      AND "resolvedByActorLabel" IS NULL
      AND "resolvedAt" IS NULL
    )
    OR (
      "status" = 'ACKNOWLEDGED'
      AND length(btrim("acknowledgedByActorId")) > 0
      AND length(btrim("acknowledgedByActorLabel")) > 0
      AND "acknowledgedAt" IS NOT NULL
      AND "resolvedByActorId" IS NULL
      AND "resolvedByActorLabel" IS NULL
      AND "resolvedAt" IS NULL
    )
    OR (
      "status" = 'RESOLVED'
      AND length(btrim("resolvedByActorId")) > 0
      AND length(btrim("resolvedByActorLabel")) > 0
      AND "resolvedAt" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "StreamUsageReconciliation_provider_sourceDigest_key"
  ON "StreamUsageReconciliation"("provider", "sourceDigest");
CREATE UNIQUE INDEX "StreamUsageReconciliation_vendorId_id_key"
  ON "StreamUsageReconciliation"("vendorId", "id");
CREATE INDEX "StreamUsageReconciliation_vendorId_monthKey_status_idx"
  ON "StreamUsageReconciliation"("vendorId", "monthKey", "status");
CREATE INDEX "StreamUsageReconciliation_vendorId_provider_monthKey_idx"
  ON "StreamUsageReconciliation"("vendorId", "provider", "monthKey");

CREATE UNIQUE INDEX "StreamOperationsAlert_dedupKey_key" ON "StreamOperationsAlert"("dedupKey");
CREATE INDEX "StreamOperationsAlert_vendorId_monthKey_status_idx"
  ON "StreamOperationsAlert"("vendorId", "monthKey", "status");
CREATE INDEX "StreamOperationsAlert_vendorId_provider_type_status_idx"
  ON "StreamOperationsAlert"("vendorId", "provider", "type", "status");
CREATE INDEX "StreamOperationsAlert_reconciliationId_idx" ON "StreamOperationsAlert"("reconciliationId");

ALTER TABLE "StreamUsageReconciliation" ADD CONSTRAINT "StreamUsageReconciliation_vendor_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StreamOperationsAlert" ADD CONSTRAINT "StreamOperationsAlert_vendor_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StreamOperationsAlert" ADD CONSTRAINT "StreamOperationsAlert_reconciliation_tenant_fkey"
  FOREIGN KEY ("vendorId", "reconciliationId") REFERENCES "StreamUsageReconciliation"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION enforce_stream_usage_reconciliation_immutable() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."vendorId" IS DISTINCT FROM OLD."vendorId"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."monthKey" IS DISTINCT FROM OLD."monthKey"
    OR NEW."sourceDigest" IS DISTINCT FROM OLD."sourceDigest"
    OR NEW."sourceReference" IS DISTINCT FROM OLD."sourceReference"
    OR NEW."providerWatchMinutes" IS DISTINCT FROM OLD."providerWatchMinutes"
    OR NEW."providerStorageMinutes" IS DISTINCT FROM OLD."providerStorageMinutes"
    OR NEW."internalWatchSeconds" IS DISTINCT FROM OLD."internalWatchSeconds"
    OR NEW."internalWatchMinutes" IS DISTINCT FROM OLD."internalWatchMinutes"
    OR NEW."differenceMinutes" IS DISTINCT FROM OLD."differenceMinutes"
    OR NEW."evidenceKind" IS DISTINCT FROM OLD."evidenceKind"
    OR NEW."capturedAt" IS DISTINCT FROM OLD."capturedAt"
    OR NEW."createdByActorId" IS DISTINCT FROM OLD."createdByActorId"
    OR NEW."createdByActorLabel" IS DISTINCT FROM OLD."createdByActorLabel"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'Stream usage reconciliation snapshot is immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'StreamUsageReconciliation_immutable_check';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    OLD."status" <> 'MISMATCH'
    OR NEW."status" <> 'RESOLVED'
  ) THEN
    RAISE EXCEPTION 'Only a mismatch may transition to resolved.'
      USING ERRCODE = '23514', CONSTRAINT = 'StreamUsageReconciliation_transition_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "StreamUsageReconciliation_immutable_trigger"
BEFORE UPDATE ON "StreamUsageReconciliation"
FOR EACH ROW EXECUTE FUNCTION enforce_stream_usage_reconciliation_immutable();
