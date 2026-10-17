import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { METRIC_SESSION_LIMITS, type MetricSessionAuthorizer, type MetricSessionContextResolver } from "./live-metric-session";
import { MetricIngestError } from "./live-metric-ingestion";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Identity = z.object({ vendorId: id, liveId: id, submissionId: id, admissionId: id }).strict();

/** Hint only: no intake, registration, session or positive evidence is written.
 * Source and issuance reauthorize normally even after this returns true.
 */
export async function metricCollectionReady(db: Pick<PrismaClient, "$transaction">, authorize: MetricSessionAuthorizer, resolveContext: MetricSessionContextResolver) {
  return db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','3000',true)`);
    const identity = Identity.parse(await authorize(tx, "resolve"));
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Live" WHERE id=${identity.liveId} AND "vendorId"=${identity.vendorId} FOR SHARE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "FormSubmission" WHERE id=${identity.submissionId} FOR NO KEY UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "LiveViewerSession" WHERE id=${identity.admissionId} FOR NO KEY UPDATE`);
    const context = await resolveContext(tx, identity);
    const current = Identity.parse(await authorize(tx, "revalidate"));
    if (current.vendorId !== identity.vendorId || current.liveId !== identity.liveId || current.submissionId !== identity.submissionId || current.admissionId !== identity.admissionId)
      throw new MetricIngestError("not_authorized");
    const [state] = await tx.$queryRaw<{ active: boolean }[]>(Prisma.sql`SELECT EXISTS(SELECT 1 FROM "LiveViewerSession" a
      JOIN "Live" l ON l.id=a."liveId" AND l."vendorId"=a."vendorId"
      JOIN "FormSubmission" f ON f.id=${identity.submissionId} AND f."liveId"=l.id AND f."formId"=l."formId"
      JOIN "RegistrationForm" form ON form.id=f."formId" AND form."vendorId"=l."vendorId"
      WHERE a.id=${identity.admissionId} AND a."vendorId"=${identity.vendorId} AND a."liveId"=${identity.liveId}
        AND a."expiresAt">clock_timestamp() AT TIME ZONE 'UTC' AND ${context.expiresAt}::timestamptz>clock_timestamp()
        AND f."verificationStatus"='VERIFIED' AND f."verifiedAt" IS NOT NULL AND f."verifiedAt"<=clock_timestamp() AT TIME ZONE 'UTC'
        AND NOT EXISTS(SELECT 1 FROM "LiveMetricRegistration" g WHERE g."vendorId"=${identity.vendorId} AND g."liveId"=${identity.liveId}
          AND g."versionId"=${context.versionId} AND g."submissionId"=f.id AND g."verifiedAt" IS DISTINCT FROM f."verifiedAt" AT TIME ZONE 'UTC')
        AND (SELECT count(*) FROM "LiveMetricSession" s WHERE s."vendorId"=${identity.vendorId} AND s."liveId"=${identity.liveId}
          AND s."admissionSessionId"=a.id)<${METRIC_SESSION_LIMITS.totalPerAdmission}
        AND (SELECT count(*) FROM "LiveMetricSession" s WHERE s."vendorId"=${identity.vendorId} AND s."liveId"=${identity.liveId}
          AND s."admissionSessionId"=a.id AND s."closedAt" IS NULL AND s."expiresAt">clock_timestamp())<${METRIC_SESSION_LIMITS.openPerAdmission}
        AND (SELECT count(*) FROM "LiveMetricSession" s JOIN "LiveMetricRegistration" g ON g.id=s."registrationId"
          WHERE s."vendorId"=${identity.vendorId} AND s."liveId"=${identity.liveId} AND s."versionId"=${context.versionId}
            AND g."submissionId"=f.id)<${METRIC_SESSION_LIMITS.totalPerRegistration}) AS active`);
    return state?.active === true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 5000, maxWait: 1000 });
}
