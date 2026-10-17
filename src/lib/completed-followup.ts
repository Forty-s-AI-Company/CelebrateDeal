import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { readMetricReadyReport } from "@/lib/live-metric-report-reader";
import { metricVideoFingerprint } from "@/lib/live-metric-version";
import { automationCustomerKeyHash } from "@/lib/automation-workflow";
import { createEmailRecipientHash, createEmailUnsubscribeUrl, protectEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { createLiveViewerUrl } from "@/lib/live-public-url";
import { FollowupSourceUnavailableError } from "@/lib/checkout-followup";
import { captureOperationalError } from "@/lib/monitoring";

const Identity = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const Scope = z.object({ vendorId: Identity, liveId: Identity, submissionId: Identity }).strict();
const Reference = Scope.extend({ reportId: Identity, ruleId: Identity, ruleVersion: z.number().int().min(1).max(2_147_483_647) }).strict();
type Reference = z.infer<typeof Reference>;
type Database = Pick<PrismaClient, "$queryRaw" | "$transaction" | "automationExecutionLog">;
const WINDOW_MS = 7 * 86_400_000;
const RETRY_MS = 5 * 60_000;
export const COMPLETED_FOLLOWUP_TRIGGER = "completed_followup";

export function completedFollowupDeliveryId(value: z.infer<typeof Scope>) {
  const s = Scope.parse(value);
  return `wp18-completed-${createHash("sha256").update(`${s.vendorId}\n${s.liveId}\n${s.submissionId}`).digest("hex")}`;
}
export function completedFollowupDeliveryKey(value: Reference) {
  const ref = Reference.parse(value);
  const key = `wp18-completed-v1:${ref.submissionId}:${ref.reportId}:${ref.ruleId}:${ref.ruleVersion}`;
  if (key.length > 256) throw new Error("Completed follow-up reference exceeds transport limit");
  return key;
}

type SourceRow = {
  personId: string; completedAtMs: number; email: string; slug: string; fingerprint: string; durationMs: number;
  videoId: string; videoVendorId: string; sourceType: string; videoUrl: string; durationSec: number;
  cloudflareStreamUid: string | null; cloudflareLiveInputUid: string | null; cloudflarePlaybackId: string | null;
};
/** Private source reader. The caller supplies a Repeatable Read transaction;
 * no caller boolean or watch-duration shortcut can certify completion. */
export async function readCompletedFollowupSource(tx: Pick<Prisma.TransactionClient, "$queryRaw">, value: Reference, now = new Date()) {
  const ref = Reference.parse(value);
  now = new Date(+z.date().parse(now));
  const [{ isolation }] = await tx.$queryRaw<Array<{ isolation: string }>>(Prisma.sql`SELECT current_setting('transaction_isolation') AS isolation, set_config('TimeZone','UTC',true)`);
  if (isolation !== "repeatable read") throw new Error("Completed follow-up requires repeatable-read snapshot");
  const [video] = await tx.$queryRaw<Array<Parameters<typeof metricVideoFingerprint>[0]>>(Prisma.sql`
    SELECT video.id,video."vendorId",video."sourceType",video."videoUrl",video."durationSec",
      video."cloudflareStreamUid",video."cloudflareLiveInputUid",video."cloudflarePlaybackId"
    FROM "Live" l JOIN "Video" video ON video.id=l."videoId" AND video."vendorId"=l."vendorId"
    WHERE l.id=${ref.liveId} AND l."vendorId"=${ref.vendorId}
  `);
  if (!video) return { status: "ineligible" as const };
  const fingerprint = metricVideoFingerprint(video);
  // Resolve current completion for the trusted outbox's tenant/live/recipient.
  // reportId stays an audit reference, not an expiry/cleanup dependency.
  const [current] = await tx.$queryRaw<Array<{ id: string; versionId: string }>>(Prisma.sql`
    SELECT fresh.id, fresh."versionId" FROM "LiveMetricReport" fresh
    JOIN "LiveMetricVersion" v ON v.id=fresh."versionId" AND v."vendorId"=fresh."vendorId" AND v."liveId"=fresh."liveId"
    WHERE fresh."vendorId"=${ref.vendorId} AND fresh."liveId"=${ref.liveId}
      AND fresh.status='ready' AND fresh."expiresAt">clock_timestamp() AND fresh."inputRevision"=v."sourceRevision"
      AND fresh."inputRegistrationRevision"=public.wp20_metric_registration_revision(fresh."vendorId",fresh."liveId")
      AND fresh."inputOrderRevision"=public.wp20_metric_order_window_revision(fresh."vendorId",fresh."windowStartAt",fresh."windowEndAt")
      AND fresh."inputOrderTenantRevision"=fresh."inputOrderRevision"
      AND v.fingerprint=${fingerprint} AND v."videoId"=${video.id}
      AND v."collectionEnabled" AND v."expiresAt">clock_timestamp() AND v."durationMs">0
      AND EXISTS (SELECT 1 FROM "LiveMetricCompletionProjection" p
        JOIN "LiveMetricRegistration" g ON g."vendorId"=fresh."vendorId" AND g."liveId"=fresh."liveId" AND g."versionId"=fresh."versionId"
        WHERE p."reportId"=fresh.id AND p."sourceRevision"=fresh."inputRevision" AND p."algorithmVersion"=1 AND g."submissionId"=${ref.submissionId}
          AND p."rowCount"=CASE WHEN jsonb_typeof(p.rows)='array' THEN jsonb_array_length(p.rows) END AND p."rowCount"<=p."cohortCount"
          AND p.rows @> jsonb_build_array(jsonb_build_object('personId',g.id)))
    ORDER BY fresh."createdAt" DESC,fresh.id DESC LIMIT 1
  `);
  if (!current) return { status: "unavailable" as const };
  const ready = await readMetricReadyReport(tx, { vendorId: ref.vendorId, liveId: ref.liveId, versionId: current.versionId, reportId: current.id });
  if (ready.status !== "available") return { status: "unavailable" as const };
  const result = ready.result as { completionRate?: { status?: string } } | null;
  if (result?.completionRate?.status !== "available") return { status: "unavailable" as const };
  const rows = await tx.$queryRaw<SourceRow[]>(Prisma.sql`
    SELECT g.id AS "personId", (CASE WHEN jsonb_typeof(c.value->'firstCompletedAtMs')='number' AND (c.value->>'firstCompletedAtMs') ~ '^[0-9]{1,16}$' THEN (c.value->>'firstCompletedAtMs')::numeric END)::float8 AS "completedAtMs", f.email,l.slug,
      v.fingerprint,v."durationMs",video.id AS "videoId",video."vendorId" AS "videoVendorId",
      video."sourceType",video."videoUrl",video."durationSec",video."cloudflareStreamUid",video."cloudflareLiveInputUid",video."cloudflarePlaybackId"
    FROM "LiveMetricReport" r JOIN "LiveMetricVersion" v ON v.id=r."versionId" AND v."vendorId"=r."vendorId" AND v."liveId"=r."liveId"
    JOIN "LiveMetricCompletionProjection" p ON p."reportId"=r.id AND p."sourceRevision"=r."inputRevision" AND p."algorithmVersion"=1
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.rows)='array' THEN p.rows ELSE '[]'::jsonb END) c(value)
    JOIN "LiveMetricRegistration" g ON g.id=c.value->>'personId' AND g."vendorId"=r."vendorId" AND g."liveId"=r."liveId" AND g."versionId"=r."versionId"
    JOIN "FormSubmission" f ON f.id=g."submissionId" AND f."liveId"=g."liveId"
    JOIN "RegistrationForm" form ON form.id=f."formId" AND form."vendorId"=g."vendorId"
    JOIN "Live" l ON l.id=g."liveId" AND l."vendorId"=g."vendorId" AND l."formId"=f."formId"
    JOIN "Video" video ON video.id=l."videoId" AND video."vendorId"=l."vendorId" AND video.id=v."videoId"
    JOIN "AutomationRule" rule ON rule.id=${ref.ruleId} AND rule."vendorId"=g."vendorId"
    WHERE r.id=${current.id} AND r."vendorId"=${ref.vendorId} AND r."liveId"=${ref.liveId} AND g."submissionId"=${ref.submissionId}
      AND v."collectionEnabled" AND v."expiresAt">clock_timestamp() AND v."durationMs">0
      AND p."rowCount"=CASE WHEN jsonb_typeof(p.rows)='array' THEN jsonb_array_length(p.rows) END AND p."rowCount"<=p."cohortCount"
      AND f."verificationStatus"='VERIFIED' AND g."verifiedAt"=f."verifiedAt" AT TIME ZONE 'UTC'
      AND form."isActive" AND (l.status IN ('scheduled','live') OR (l.status='ended' AND l."replayEnabled"
        AND (l."replayAvailableUntil" IS NULL OR l."replayAvailableUntil">clock_timestamp())))
      AND g."verifiedAt">=r."windowStartAt" AND g."verifiedAt"<r."windowEndAt"
      AND (c.value->>'firstCompletedAtMs') ~ '^[0-9]{1,16}$'
      AND (CASE WHEN jsonb_typeof(c.value->'firstCompletedAtMs')='number' AND (c.value->>'firstCompletedAtMs') ~ '^[0-9]{1,16}$' THEN (c.value->>'firstCompletedAtMs')::numeric END) >= extract(epoch FROM g."verifiedAt")*1000
      AND (CASE WHEN jsonb_typeof(c.value->'firstCompletedAtMs')='number' AND (c.value->>'firstCompletedAtMs') ~ '^[0-9]{1,16}$' THEN (c.value->>'firstCompletedAtMs')::numeric END) < extract(epoch FROM r."windowEndAt")*1000
      AND rule.trigger='viewer_completed' AND rule."isActive" AND rule."funnelPageId" IS NULL AND rule.version=${ref.ruleVersion}
      AND rule.condition='{"type":"completed_and_not_ordered"}'::jsonb
      AND rule.actions='[{"type":"send_email_notification","template":"completed_followup"}]'::jsonb
      AND extract(epoch FROM rule."createdAt")*1000 <= (CASE WHEN jsonb_typeof(c.value->'firstCompletedAtMs')='number' AND (c.value->>'firstCompletedAtMs') ~ '^[0-9]{1,16}$' THEN (c.value->>'firstCompletedAtMs')::numeric END)
      AND extract(epoch FROM rule."updatedAt")*1000 <= (CASE WHEN jsonb_typeof(c.value->'firstCompletedAtMs')='number' AND (c.value->>'firstCompletedAtMs') ~ '^[0-9]{1,16}$' THEN (c.value->>'firstCompletedAtMs')::numeric END)
    LIMIT 2
  `);
  if (rows.length !== 1) return { status: "ineligible" as const };
  const row = rows[0];
  if (!Number.isSafeInteger(row.completedAtMs) || row.completedAtMs > +now || row.completedAtMs < +now-WINDOW_MS
    || row.fingerprint !== metricVideoFingerprint({ id: row.videoId, vendorId: row.videoVendorId, ...row })
    || row.durationMs !== row.durationSec*1000) return { status: "ineligible" as const };
  if (!z.string().trim().email().safeParse(row.email).success) return { status: "ineligible" as const };
  let recipientHash: string, customerKey: string;
  try { recipientHash = createEmailRecipientHash(row.email, ref.vendorId); customerKey = automationCustomerKeyHash(ref.vendorId, row.email); }
  catch { throw new FollowupSourceUnavailableError(); }
  // Pending is already an order. Match trusted checkout attribution, including
  // another live/registration with the same normalized Email, without decrypting
  // or exporting unrelated orders. Existing customer hashes are conservative.
  const [order] = await tx.$queryRaw<Array<{ exists: boolean; attributionUnknown: boolean }>>(Prisma.sql`
    SELECT EXISTS (SELECT 1 FROM "CommerceOrder" o
      LEFT JOIN "PaymentTransaction" payment ON payment."vendorId"=o."vendorId"
        AND (payment.id=o."primaryPaymentTransactionId" OR payment."orderNumber"=o."orderNumber")
      WHERE o."vendorId"=${ref.vendorId} AND o.status<>'draft' AND (
        o."automationCustomerKeyHash"=${customerKey} OR (
          payment.metadata->>'billingPurpose'='buyer_order'
          AND EXISTS (SELECT 1 FROM "FormSubmission" buyer JOIN "RegistrationForm" buyerform ON buyerform.id=buyer."formId"
            JOIN "Live" buyerLive ON buyerLive.id=buyer."liveId" AND buyerLive."vendorId"=${ref.vendorId}
            WHERE buyer.id=payment.metadata->>'formSubmissionId' AND buyer."liveId"=payment.metadata->>'sourceLiveId' AND buyerform."vendorId"=${ref.vendorId}
              AND lower(trim(buyer.email))=${row.email.trim().toLowerCase()})))) AS exists,
      EXISTS (SELECT 1 FROM "CommerceOrder" unknownorder WHERE unknownorder."vendorId"=${ref.vendorId}
        AND unknownorder.status<>'draft' AND unknownorder."automationCustomerKeyHash" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "PaymentTransaction" attempt
          JOIN "FormSubmission" buyer ON buyer.id=attempt.metadata->>'formSubmissionId' AND buyer."liveId"=attempt.metadata->>'sourceLiveId'
          JOIN "RegistrationForm" buyerform ON buyerform.id=buyer."formId" AND buyerform."vendorId"=unknownorder."vendorId"
          JOIN "Live" buyerLive ON buyerLive.id=buyer."liveId" AND buyerLive."vendorId"=unknownorder."vendorId"
          WHERE attempt."vendorId"=unknownorder."vendorId" AND attempt.metadata->>'billingPurpose'='buyer_order'
            AND (attempt.id=unknownorder."primaryPaymentTransactionId" OR attempt."orderNumber"=unknownorder."orderNumber"))) AS "attributionUnknown"
  `);
  if (order?.exists) return { status: "ineligible" as const };
  // An unclassified legacy/partial order is missing evidence, not no order.
  // Return availability without reading/decrypting unrelated buyers' PII.
  if (!order || order.attributionUnknown) return { status: "unavailable" as const };
  return { status: "eligible" as const, recipientEmail: row.email, recipientHash, customerKey, personId: row.personId, liveSlug: row.slug };
}

export async function isCurrentCompletedFollowupDelivery(delivery: {
  id: string; vendorId: string; trigger: string; sourceLiveId: string | null; sourceFormSubmissionId: string | null;
  idempotencyKey?: string; recipientHash?: string;
}, db: Partial<Pick<PrismaClient, "$transaction">>, now = new Date()) {
  if (delivery.trigger !== COMPLETED_FOLLOWUP_TRIGGER) return true;
  const parts = (delivery.idempotencyKey ?? "").split(":");
  if (parts.length!==5 || parts[0]!=="wp18-completed-v1" || parts[1]!==delivery.sourceFormSubmissionId
    || !/^[1-9]\d{0,9}$/u.test(parts[4]) || (delivery.idempotencyKey?.length ?? 0)>256) return false;
  const parsed = Reference.safeParse({ vendorId: delivery.vendorId, liveId: delivery.sourceLiveId, submissionId: delivery.sourceFormSubmissionId,
    reportId: parts[2], ruleId: parts[3], ruleVersion: Number(parts[4]) });
  if (!parsed.success || delivery.id!==completedFollowupDeliveryId(Scope.parse({vendorId:parsed.data.vendorId,liveId:parsed.data.liveId,submissionId:parsed.data.submissionId}))
    || !/^[A-Za-z0-9_-]{43}$/u.test(delivery.recipientHash ?? "")) return false;
  if (!db.$transaction) throw new FollowupSourceUnavailableError();
  return db.$transaction(async tx => {
    const source = await readCompletedFollowupSource(tx, parsed.data, now);
    if (source.status==="unavailable") throw new FollowupSourceUnavailableError();
    return source.status==="eligible" && source.recipientHash===delivery.recipientHash;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000 });
}

/** Existing job recovers current, durable completion facts in bounded batches.
 * SQL only selects opaque references. Eligibility/PII stay in a short RR tx. */
export async function processDueCompletedFollowups(db: Database, options: { now?: Date; limit?: number } = {}) {
  const now = z.date().parse(options.now ?? new Date());
  const limit = z.number().int().min(1).max(100).parse(options.limit ?? 50);
  const pairs = await db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true),set_config('lock_timeout','1000',true),set_config('TimeZone','UTC',true)`);
    return tx.$queryRaw<Reference[]>(Prisma.sql`
    WITH ready_reports AS MATERIALIZED (
      SELECT r.* FROM "LiveMetricReport" r JOIN "LiveMetricVersion" v ON v.id=r."versionId" AND v."vendorId"=r."vendorId" AND v."liveId"=r."liveId"
      WHERE r.status='ready' AND r."expiresAt">clock_timestamp() AND v."collectionEnabled" AND v."expiresAt">clock_timestamp()
        AND r."createdAt">=${new Date(+now-WINDOW_MS).toISOString()}::timestamptz
        AND EXISTS (SELECT 1 FROM "AutomationRule" active WHERE active."vendorId"=r."vendorId" AND active.trigger='viewer_completed'
          AND active."isActive" AND active."funnelPageId" IS NULL AND active.condition='{"type":"completed_and_not_ordered"}'::jsonb
          AND active.actions='[{"type":"send_email_notification","template":"completed_followup"}]'::jsonb)
        AND r."inputRevision"=v."sourceRevision" AND r."inputRegistrationRevision"=public.wp20_metric_registration_revision(r."vendorId",r."liveId")
        AND r."inputOrderRevision"=public.wp20_metric_order_window_revision(r."vendorId",r."windowStartAt",r."windowEndAt") AND r."inputOrderTenantRevision"=r."inputOrderRevision"
    )
    SELECT candidates.* FROM (
      SELECT DISTINCT ON (r."vendorId",r."liveId",g."submissionId") r."vendorId",r."liveId",g."submissionId",r.id AS "reportId",rule.id AS "ruleId",rule.version AS "ruleVersion",
        attempt."startedAt" AS tried,(CASE WHEN jsonb_typeof(c.value->'firstCompletedAtMs')='number' AND (c.value->>'firstCompletedAtMs') ~ '^[0-9]{1,16}$' THEN (c.value->>'firstCompletedAtMs')::numeric END)::float8 AS completed
      FROM ready_reports r
      JOIN "LiveMetricCompletionProjection" p ON p."reportId"=r.id AND p."sourceRevision"=r."inputRevision" AND p."algorithmVersion"=1
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.rows)='array' THEN p.rows ELSE '[]'::jsonb END) c(value)
      JOIN "LiveMetricRegistration" g ON g.id=c.value->>'personId' AND g."vendorId"=r."vendorId" AND g."liveId"=r."liveId" AND g."versionId"=r."versionId"
      JOIN "FormSubmission" candidate ON candidate.id=g."submissionId" AND candidate."liveId"=g."liveId"
      JOIN "RegistrationForm" candidateform ON candidateform.id=candidate."formId" AND candidateform."vendorId"=g."vendorId"
      JOIN LATERAL (SELECT rule.* FROM "AutomationRule" rule WHERE rule."vendorId"=r."vendorId" AND rule.trigger='viewer_completed'
        AND rule."isActive" AND rule."funnelPageId" IS NULL AND rule.version BETWEEN 1 AND 2147483647
        AND rule.condition='{"type":"completed_and_not_ordered"}'::jsonb AND rule.actions='[{"type":"send_email_notification","template":"completed_followup"}]'::jsonb
        AND extract(epoch FROM rule."updatedAt")*1000 <= (CASE WHEN jsonb_typeof(c.value->'firstCompletedAtMs')='number' AND (c.value->>'firstCompletedAtMs') ~ '^[0-9]{1,16}$' THEN (c.value->>'firstCompletedAtMs')::numeric END)
        ORDER BY rule."createdAt",rule.id LIMIT 1) rule ON true
      LEFT JOIN "AutomationExecutionLog" attempt ON attempt."vendorId"=r."vendorId" AND attempt."idempotencyKey"=
        'wp18-completed-'||encode(sha256(convert_to(r."vendorId"||chr(10)||r."liveId"||chr(10)||g."submissionId",'UTF8')),'hex')
      WHERE candidate."verificationStatus"='VERIFIED' AND g."verifiedAt"=candidate."verifiedAt" AT TIME ZONE 'UTC'
        AND r."vendorId" ~ '^[A-Za-z0-9_-]{1,128}$' AND r."liveId" ~ '^[A-Za-z0-9_-]{1,128}$'
        AND r.id ~ '^[A-Za-z0-9_-]{1,128}$' AND g."submissionId" ~ '^[A-Za-z0-9_-]{1,128}$' AND rule.id ~ '^[A-Za-z0-9_-]{1,128}$'
        AND length('wp18-completed-v1:'||g."submissionId"||':'||r.id||':'||rule.id||':'||rule.version::text)<=256
        AND (c.value->>'firstCompletedAtMs') ~ '^[0-9]{1,16}$'
        AND (CASE WHEN jsonb_typeof(c.value->'firstCompletedAtMs')='number' AND (c.value->>'firstCompletedAtMs') ~ '^[0-9]{1,16}$' THEN (c.value->>'firstCompletedAtMs')::numeric END) BETWEEN ${+now-WINDOW_MS}::bigint AND ${+now}::bigint
        AND (attempt.id IS NULL OR (attempt.status='failed' AND attempt."startedAt"<=(${new Date(+now-RETRY_MS).toISOString()}::timestamptz AT TIME ZONE 'UTC')))
        AND NOT EXISTS (SELECT 1 FROM "EmailDelivery" d WHERE d.id='wp18-completed-'||encode(sha256(convert_to(r."vendorId"||chr(10)||r."liveId"||chr(10)||g."submissionId",'UTF8')),'hex'))
      ORDER BY r."vendorId",r."liveId",g."submissionId",r."createdAt" DESC,r.id DESC
    ) candidates ORDER BY tried NULLS FIRST,completed,"submissionId" LIMIT ${limit}
    `);
  }, { timeout: 10000 });
  const results: Array<{status:string}> = [];
  for (const pair of pairs) {
    const {vendorId,liveId,submissionId,reportId,ruleId,ruleVersion}=pair;
    const ref = {vendorId,liveId,submissionId,reportId,ruleId,ruleVersion};
    let key: string, id: string;
    try { key=completedFollowupDeliveryKey(ref); id=completedFollowupDeliveryId({vendorId,liveId,submissionId}); }
    catch { results.push({status:"invalid_snapshot"}); continue; }
    const logIdentity={vendorId,ruleId,idempotencyKey:id,eventId:reportId,liveId,trigger:"viewer_completed",subjectType:"buyer_registration"};
    try {
      const status=await db.$transaction(async tx=>{
        const locked=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM "FormSubmission" WHERE id=${submissionId} AND "liveId"=${liveId} FOR UPDATE SKIP LOCKED`);
        if (locked.length!==1) return "claimed_elsewhere";
        if (await tx.emailDelivery.findUnique({where:{id},select:{id:true}})) return "duplicate";
        const previous=await tx.automationExecutionLog.findUnique({where:{vendorId_idempotencyKey:{vendorId,idempotencyKey:id}},select:{status:true,startedAt:true}});
        if (previous && (previous.status!=="failed" || +previous.startedAt>+now-RETRY_MS)) return "duplicate";
        const source=await readCompletedFollowupSource(tx,ref,now);
        if(source.status==="unavailable") throw new FollowupSourceUnavailableError();
        if(source.status==="ineligible") {
          await tx.automationExecutionLog.upsert({where:{vendorId_idempotencyKey:{vendorId,idempotencyKey:id}},
            create:{...logIdentity,status:"skipped",conditionMatched:false,completedAt:now},update:{status:"skipped",conditionMatched:false,completedAt:now}});
          return "superseded";
        }
        const payload=protectEmailDeliveryPayload({recipientEmail:source.recipientEmail,subject:"活動結束後的下一步",
          body:`謝謝您參與活動！若仍在考慮，可回到活動頁查看方案內容與相關說明：\n${createLiveViewerUrl(source.liveSlug)}\n\n取消訂閱：${createEmailUnsubscribeUrl(id)}`},{vendorId,deliveryId:id});
        await tx.emailDelivery.create({data:{id,vendorId,sourceLiveId:liveId,sourceFormSubmissionId:submissionId,sourceTemplateId:"automation_completed_followup_v1",
          trigger:COMPLETED_FOLLOWUP_TRIGGER,...payload,idempotencyKey:key,status:"queued",nextAttemptAt:now}});
        const completed={status:"completed",conditionMatched:true,subjectKeyHash:source.customerKey,completedAt:now,errorCode:null,
          actionResults:[{type:"send_email_notification",status:"queued",template:"completed_followup"}]};
        await tx.automationExecutionLog.upsert({where:{vendorId_idempotencyKey:{vendorId,idempotencyKey:id}},create:{...logIdentity,...completed},update:completed});
        return "queued";
      },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:10000});
      results.push({status});
    } catch(error) {
      if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==="P2002") {results.push({status:"duplicate"});continue;}
      try {captureOperationalError(new Error("Completed follow-up unavailable"),{source:"completed_followup",operation:"materialize",status:"failed"});} catch { /* No raw source details. */ }
      try {
        await db.automationExecutionLog.upsert({where:{vendorId_idempotencyKey:{vendorId,idempotencyKey:id}},create:{...logIdentity,status:"failed",startedAt:now,errorCode:"completed_source_unavailable"},update:{}});
        await db.automationExecutionLog.updateMany({where:{vendorId,idempotencyKey:id,status:"failed"},data:{startedAt:now,errorCode:"completed_source_unavailable"}});
      } catch { /* A failed receipt cannot discard later pairs. */ }
      results.push({status:"failed"});
    }
  }
  return results;
}
