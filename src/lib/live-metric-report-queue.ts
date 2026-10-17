import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Input = z.object({ vendorId: id, liveId: id, versionId: id, startAt: z.date(), endAt: z.date(),
  retentionSeconds: z.number().int().min(1).max(86400).default(3600) }).strict()
  .refine(value => +value.startAt >= 0 && value.startAt < value.endAt, "Invalid report window");

/** Private queue producer. The host supplies an authorized, explicit scope and
 * fixed window; no global scan, source enablement or coverage assertion here.
 * Serialize dedup with the same version-first order as create/claim/finish.
 * A failed generation is not silently retried with a fresh five-attempt cap.
 */
export async function enqueueMetricReport(db: Pick<PrismaClient, "$transaction">, value: z.input<typeof Input>) {
  const parsed = Input.parse(value);
  // Zod retains Date references. Copy before the first await so a host reusing
  // mutable schedule objects cannot change a validated window mid-transaction.
  const input = { ...parsed, startAt: new Date(parsed.startAt), endAt: new Date(parsed.endAt) };
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout','5000',true),set_config('TimeZone','UTC',true)`);
      const [version] = await tx.$queryRaw<{ sourceRevision: bigint; expiresAt: Date }[]>(Prisma.sql`
        SELECT v."sourceRevision",LEAST(v."expiresAt",clock_timestamp()+${input.retentionSeconds}*INTERVAL '1 second') AS "expiresAt"
        FROM "LiveMetricVersion" v JOIN "Live" l ON l.id=v."liveId" AND l."vendorId"=v."vendorId"
        WHERE v.id=${input.versionId} AND v."vendorId"=${input.vendorId} AND v."liveId"=${input.liveId}
          AND v."collectionEnabled" AND v."collectionStartedAt"<=${input.startAt}::timestamptz
          AND v."expiresAt">clock_timestamp() AND v."expiresAt">=${input.endAt}::timestamptz AND ${input.endAt}::timestamptz<=clock_timestamp()
        FOR UPDATE OF v`);
      if (!version) return { status: "unavailable" as const, reason: "scope_or_window_unavailable" as const };
      const [existing] = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`
        SELECT r.status FROM "LiveMetricReport" r WHERE r."vendorId"=${input.vendorId} AND r."liveId"=${input.liveId}
          AND r."versionId"=${input.versionId} AND r."windowStartAt"=${input.startAt}::timestamptz AND r."windowEndAt"=${input.endAt}::timestamptz
          AND r.status IN ('queued','running','ready','failed') AND (r.status='failed' OR r."expiresAt">clock_timestamp())
          AND r."inputRevision"=${version.sourceRevision}
          AND r."inputRegistrationRevision"=public.wp20_metric_registration_revision(${input.vendorId},${input.liveId})
          AND r."inputOrderRevision"=public.wp20_metric_order_window_revision(${input.vendorId},${input.startAt}::timestamptz,${input.endAt}::timestamptz)
          AND r."inputOrderTenantRevision"=r."inputOrderRevision"
        ORDER BY CASE WHEN r.status='failed' THEN 1 ELSE 0 END,r."createdAt" DESC,r.id LIMIT 1`);
      if (existing?.status === "failed") return { status: "unavailable" as const, reason: "previous_failure" as const };
      if (existing) return { status: "available" as const, created: false };
      const [created] = await tx.$queryRaw<{ changed: number }[]>(Prisma.sql`
        SELECT public.wp20_metric_report_create(${input.vendorId},${input.liveId},${input.versionId},${randomUUID()},
          ${input.startAt}::timestamptz,${input.endAt}::timestamptz,${version.sourceRevision}::bigint,${version.expiresAt}::timestamptz) AS changed`);
      if (created?.changed !== 1) throw new Error("Report enqueue not confirmed");
      return { status: "available" as const, created: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000, maxWait: 5000 });
  } catch (error) {
    // Expose only fixed classes, never driver messages, query text or row data.
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const state = typeof error.meta?.code === "string" ? error.meta.code : "";
      if (["P2034", "P2024"].includes(error.code) || ["55P03", "57014", "40001", "40P01"].includes(state))
        return { status: "unavailable" as const, reason: "contention" as const };
      if (["P2002", "P2003", "P2004"].includes(error.code) || /^23[0-9A-Z]{3}$/.test(state))
        return { status: "unavailable" as const, reason: "integrity_violation" as const };
    }
    return { status: "unavailable" as const, reason: "enqueue_failed" as const };
  }
}
