import { Prisma } from "@prisma/client";
import { z } from "zod";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Request = z.object({ vendorId: id, liveId: id, versionId: id, startAt: z.date(), endAt: z.date(),
  afterSubmissionId: id.nullable(), take: z.number().int().min(1).max(500) }).strict()
  .refine(value => value.startAt < value.endAt, "Invalid audit window");
export type RegistrationAuditRequest = z.infer<typeof Request>;
type Database = Pick<Prisma.TransactionClient, "$queryRaw">;
type Row = { submissionId: string; captureVersionId: string | null; registrationId: string | null; formMatches: boolean; matches: boolean };

/** Internal evidence discovery, not a coverage certificate. Caller owns one
 * bounded read-only RR transaction across all pages. Start from source submissions
 * so an absent capture cannot disappear from the audit. No customer PII is read.
 */
export async function readRegistrationAuditPage(tx: Database, value: RegistrationAuditRequest) {
  const input = Request.parse(value);
  const context = await readAuditContext(tx, input);
  if (!context) return { status: "unavailable" as const, reason: "scope_or_window_unavailable" as const };
  const cursor = input.afterSubmissionId === null ? Prisma.empty : Prisma.sql`AND s.id>${input.afterSubmissionId}`;
  const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
    SELECT coalesce(l."formId"=s."formId" AND f."vendorId"=${input.vendorId},false) AS "formMatches",
      s.id AS "submissionId",c."versionId" AS "captureVersionId",g.id AS "registrationId",
      coalesce(g."verifiedAt"=(s."verifiedAt" AT TIME ZONE 'UTC') AND g."visitorId" IS NOT DISTINCT FROM c."visitorId",false) AS matches
    FROM "FormSubmission" s
    JOIN "Live" l ON l.id=s."liveId" AND l."vendorId"=${input.vendorId}
    LEFT JOIN "RegistrationForm" f ON f.id=s."formId"
    LEFT JOIN "LiveMetricRegistrationCapture" c ON c."submissionId"=s.id AND c."vendorId"=${input.vendorId} AND c."liveId"=${input.liveId}
    LEFT JOIN "LiveMetricRegistration" g ON g."submissionId"=s.id AND g."vendorId"=${input.vendorId}
      AND g."liveId"=${input.liveId} AND g."versionId"=${input.versionId}
    WHERE s."liveId"=${input.liveId} AND s."verificationStatus"='VERIFIED'
      AND s."verifiedAt">=(${input.startAt}::timestamptz AT TIME ZONE 'UTC')
      AND s."verifiedAt"<(${input.endAt}::timestamptz AT TIME ZONE 'UTC') ${cursor}
    ORDER BY s.id ASC LIMIT ${input.take + 1}`);
  const page = rows.slice(0, input.take);
  return { status: "available" as const, sourceRevision: context.sourceRevision, registrationRevision: context.registrationRevision, coverage: "unknown" as const,
    rows: page.map(row => ({ submissionId: row.submissionId,
      outcome: !row.formMatches ? "form_mismatch" as const
        : row.captureVersionId === null ? "missing_capture" as const
        : row.captureVersionId !== input.versionId ? "other_version" as const
        : row.registrationId === null ? "missing_registration" as const
        : !row.matches ? "identity_mismatch" as const : "matched" as const })),
    hasMore: rows.length > input.take, nextSubmissionId: page.at(-1)?.submissionId ?? input.afterSubmissionId };
}

async function readAuditContext(tx: Database, input: RegistrationAuditRequest) {
  const [settings] = await tx.$queryRaw<{ isolation: string; readOnly: string }[]>(Prisma.sql`
    SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS "readOnly"`);
  if (settings?.isolation !== "repeatable read" || settings.readOnly !== "on") throw new Error("Registration audit requires read-only repeatable-read");
  const [context] = await tx.$queryRaw<{ sourceRevision: bigint; registrationRevision: bigint }[]>(Prisma.sql`
    SELECT v."sourceRevision",public.wp20_metric_registration_revision(v."vendorId",v."liveId") AS "registrationRevision" FROM "LiveMetricVersion" v
    JOIN "Live" l ON l.id=v."liveId" AND l."vendorId"=v."vendorId"
    WHERE v.id=${input.versionId} AND v."vendorId"=${input.vendorId} AND v."liveId"=${input.liveId}
      AND v."collectionStartedAt"<=${input.startAt} AND v."expiresAt">=${input.endAt}
      AND ${input.endAt}<=clock_timestamp()`);
  return context;
}

/** Reverse enumeration catches persisted cohort rows no longer represented by
 * an eligible verified source. It must share the forward audit's RR snapshot.
 */
export async function readRegistrationProjectionAuditPage(tx: Database, value: RegistrationAuditRequest) {
  const input = Request.parse(value);
  const context = await readAuditContext(tx, input);
  if (!context) return { status: "unavailable" as const, reason: "scope_or_window_unavailable" as const };
  const cursor = input.afterSubmissionId === null ? Prisma.empty : Prisma.sql`AND g.id>${input.afterSubmissionId}`;
  const rows = await tx.$queryRaw<{ registrationId: string; sourceMatches: boolean; captureExists: boolean; captureMatches: boolean }[]>(Prisma.sql`
    SELECT g.id AS "registrationId",
      coalesce(s."verificationStatus"='VERIFIED' AND s."liveId"=g."liveId" AND s."formId"=l."formId"
        AND f."vendorId"=g."vendorId" AND g."verifiedAt"=(s."verifiedAt" AT TIME ZONE 'UTC'),false) AS "sourceMatches",
      c."submissionId" IS NOT NULL AS "captureExists",
      coalesce(c."versionId"=g."versionId" AND c."visitorId" IS NOT DISTINCT FROM g."visitorId",false) AS "captureMatches"
    FROM "LiveMetricRegistration" g
    JOIN "Live" l ON l.id=g."liveId" AND l."vendorId"=g."vendorId"
    LEFT JOIN "FormSubmission" s ON s.id=g."submissionId"
    LEFT JOIN "RegistrationForm" f ON f.id=s."formId"
    LEFT JOIN "LiveMetricRegistrationCapture" c ON c."submissionId"=g."submissionId"
      AND c."vendorId"=g."vendorId" AND c."liveId"=g."liveId"
    WHERE g."vendorId"=${input.vendorId} AND g."liveId"=${input.liveId} AND g."versionId"=${input.versionId}
      AND g."verifiedAt">=${input.startAt} AND g."verifiedAt"<${input.endAt} ${cursor}
    ORDER BY g.id ASC LIMIT ${input.take + 1}`);
  const page = rows.slice(0, input.take);
  return { status: "available" as const, ...context, coverage: "unknown" as const,
    rows: page.map(row => ({ registrationId: row.registrationId,
      outcome: !row.sourceMatches ? "invalid_source" as const : !row.captureExists ? "registration_without_capture" as const
        : !row.captureMatches ? "capture_mismatch" as const : "matched" as const })),
    hasMore: rows.length > input.take, nextRegistrationId: page.at(-1)?.registrationId ?? input.afterSubmissionId };
}
