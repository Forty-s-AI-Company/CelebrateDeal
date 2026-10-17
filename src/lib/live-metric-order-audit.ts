import { Prisma } from "@prisma/client";
import { z } from "zod";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Request = z.object({ vendorId: id, liveId: id, versionId: id, startAt: z.date(), endAt: z.date(),
  afterId: id.nullable(), take: z.number().int().min(1).max(500) }).strict()
  .refine(value => value.startAt < value.endAt, "Invalid order audit window");
type Outcome = "missing_payment" | "missing_attribution" | "other_purpose" | "other_live" |
  "invalid_source" | "outside_cohort" | "missing_registration" | "identity_mismatch" | "matched";
/** Enumerate ALL established tenant orders in the interval, not just successful
 * attribution joins. Internal IDs/classifications only; never a coverage certificate.
 * Tenant revision includes unattributed orders. Callers must still complete the
 * full audit and recheck all revisions before any separate proof publication.
 */
export async function readMetricOrderAuditPage(tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  value: z.infer<typeof Request>) {
  const input = Request.parse(value);
  const cached = contexts.get(tx);
  const context = cached?.key === scopeKey(input) ? cached.context : await readAuditContext(tx, input);
  if (!context) return { status: "unavailable" as const, reason: "scope_or_window_unavailable" as const };
  const cursor = input.afterId === null ? Prisma.empty : Prisma.sql`AND o.id>${input.afterId}`;
  const rows = await tx.$queryRaw<{ orderId: string; outcome: Outcome }[]>(Prisma.sql`
    SELECT o.id AS "orderId",CASE
      WHEN p.id IS NULL THEN 'missing_payment'
      WHEN coalesce(p.metadata->>'billingPurpose','')='' THEN 'missing_attribution'
      WHEN p.metadata->>'billingPurpose'<>'buyer_order' THEN 'other_purpose'
      WHEN coalesce(p.metadata->>'sourceLiveId','')='' OR coalesce(p.metadata->>'formSubmissionId','')='' THEN 'missing_attribution'
      WHEN p.metadata->>'sourceLiveId'<>${input.liveId} THEN 'other_live'
      WHEN s.id IS NULL OR s."liveId" IS DISTINCT FROM ${input.liveId} OR s."verificationStatus"<>'VERIFIED'
        OR f."vendorId" IS DISTINCT FROM ${input.vendorId} OR l."formId" IS DISTINCT FROM s."formId" OR s."verifiedAt" IS NULL THEN 'invalid_source'
      WHEN s."verifiedAt"<(${input.startAt}::timestamptz AT TIME ZONE 'UTC')
        OR s."verifiedAt">=(${input.endAt}::timestamptz AT TIME ZONE 'UTC') THEN 'outside_cohort'
      WHEN g.id IS NULL THEN 'missing_registration'
      WHEN g."verifiedAt" IS DISTINCT FROM (s."verifiedAt" AT TIME ZONE 'UTC') THEN 'identity_mismatch'
      ELSE 'matched' END AS outcome
    FROM "CommerceOrder" o
    LEFT JOIN "PaymentTransaction" p ON p.id=o."primaryPaymentTransactionId" AND p."vendorId"=o."vendorId"
    LEFT JOIN "FormSubmission" s ON s.id=p.metadata->>'formSubmissionId'
    LEFT JOIN "RegistrationForm" f ON f.id=s."formId" AND f."vendorId"=o."vendorId"
    LEFT JOIN "Live" l ON l.id=${input.liveId} AND l."vendorId"=o."vendorId"
    LEFT JOIN "LiveMetricRegistration" g ON g."submissionId"=s.id AND g."vendorId"=o."vendorId"
      AND g."liveId"=${input.liveId} AND g."versionId"=${input.versionId}
    WHERE o."vendorId"=${input.vendorId} AND o.status<>'draft'
      AND o."createdAt">=(${input.startAt}::timestamptz AT TIME ZONE 'UTC')
      AND o."createdAt"<(${input.endAt}::timestamptz AT TIME ZONE 'UTC') ${cursor}
    ORDER BY o.id LIMIT ${input.take + 1}`);
  const page = rows.slice(0, input.take);
  return { status: "available" as const, ...context, coverage: "unknown" as const,
    rows: page, hasMore: rows.length > input.take, nextId: page.at(-1)?.orderId ?? input.afterId };
}

type ReadClient = Pick<Prisma.TransactionClient, "$queryRaw">;
type AuditRequest = z.infer<typeof Request>;
type AuditScope = Omit<AuditRequest, "afterId" | "take">;
type AuditContext = { sourceRevision: bigint; orderRevision: bigint; tenantRevision: bigint; registrationRevision: bigint };
const contexts = new WeakMap<ReadClient, { key: string; context: AuditContext | undefined }>();
const scopeKey = (value: AuditScope) => JSON.stringify([value.vendorId, value.liveId, value.versionId,
  value.startAt.getTime(), value.endAt.getTime()]);

/** A new facade caches one validated scope for one RR callback. A different
 * scope is independently validated on every read and never uses this cache.
 * No caller-supplied revisions, reusable-client cache, or cache after callback exit.
 */
export async function withMetricOrderAuditContext<T>(tx: ReadClient, value: AuditScope,
  read: (snapshot: ReadClient) => Promise<T>): Promise<T> {
  const input = Request.parse({ ...value, afterId: null, take: 1 });
  const context = await readAuditContext(tx, input);
  const snapshot: ReadClient = { $queryRaw: tx.$queryRaw.bind(tx) };
  contexts.set(snapshot, { key: scopeKey(input), context });
  try { return await read(snapshot); }
  finally { contexts.delete(snapshot); }
}

async function readAuditContext(tx: ReadClient, input: AuditRequest) {
  const [settings] = await tx.$queryRaw<{ isolation: string; readOnly: string }[]>(Prisma.sql`
    SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS "readOnly"`);
  if (settings?.isolation !== "repeatable read" || settings.readOnly !== "on") throw new Error("Order audit requires read-only repeatable-read");
  const [context] = await tx.$queryRaw<AuditContext[]>(Prisma.sql`
    SELECT v."sourceRevision",public.wp20_metric_order_window_revision(v."vendorId",${input.startAt},${input.endAt}) AS "tenantRevision",public.wp20_metric_order_window_revision(v."vendorId",${input.startAt},${input.endAt}) AS "orderRevision",
      public.wp20_metric_registration_revision(v."vendorId",v."liveId") AS "registrationRevision"
    FROM "LiveMetricVersion" v JOIN "Live" l ON l.id=v."liveId" AND l."vendorId"=v."vendorId"
    WHERE v.id=${input.versionId} AND v."vendorId"=${input.vendorId} AND v."liveId"=${input.liveId}
      AND v."collectionStartedAt"<=${input.startAt} AND v."expiresAt">=${input.endAt} AND ${input.endAt}<=clock_timestamp()`);
  return context;
}
