import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { CoreMetrics } from "./live-core-metrics-read-model";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Scope = z.object({ vendorId: id, liveId: id, versionId: id, reportId: id, workerId: id }).strict();
export type MetricReportLease = z.infer<typeof Scope>;
type Database = Pick<PrismaClient, "$queryRaw">;
const unavailable = z.object({ status: z.literal("unavailable"), reason: z.enum(["missing_data", "invalid_data", "limit_exceeded"]) }).strict();
const empty = z.object({ status: z.literal("not_applicable"), reason: z.literal("zero_denominator") }).strict();
const available = z.object({ status: z.literal("available"), value: z.number().finite().nonnegative(),
  numerator: z.number().finite().nonnegative(), denominator: z.number().finite().positive(), unit: z.enum(["percent", "seconds"]) }).strict();
const metric = z.union([unavailable, empty, available]);
const Report = z.object({ registrationRate: metric, attendanceRate: metric, completionRate: metric,
  averageViewingSeconds: metric, postCompletionOrderRate: metric,
  unattributedRegistrations: z.number().int().nonnegative().nullable(), provisionalConversions: z.boolean().nullable() }).strict();

/** Claim one already-authorized report from a background runner. The database
 * clock and guarded function own lease expiry, attempts and lock ordering.
 * This is not an HTTP authorization boundary and does not compute on a page.
 */
export async function claimMetricReport(db: Database, value: MetricReportLease): Promise<boolean> {
  const scope = Scope.parse(value);
  const [row] = await db.$queryRaw<{ changed: number }[]>(Prisma.sql`
    SELECT public.wp20_metric_report_claim(${scope.vendorId},${scope.liveId},${scope.versionId},${scope.reportId},${scope.workerId},
      date_trunc('milliseconds',clock_timestamp()) + INTERVAL '2 minutes') AS changed`);
  return row?.changed === 1;
}

/** Only aggregate output crosses this boundary. Reject raw facts, identifiers
 * or nonfinite numbers before writing; never accept a worker's arbitrary JSON.
 * A false result means the lease/input revision was lost, not successful work.
 */
export async function finishMetricReport(db: Database, value: MetricReportLease, result: CoreMetrics): Promise<boolean> {
  const scope = Scope.parse(value);
  const aggregate = Report.parse(result);
  for (const key of ["registrationRate", "attendanceRate", "completionRate", "averageViewingSeconds", "postCompletionOrderRate"] as const) {
    const item = aggregate[key];
    if (item.status !== "available") continue;
    const unit = key === "averageViewingSeconds" ? "seconds" : "percent";
    const expected = item.numerator / item.denominator * (unit === "percent" ? 100 : 1);
    if (item.unit !== unit || item.value !== expected || (unit === "percent" && item.numerator > item.denominator)) throw new Error("Invalid metric aggregate");
  }
  const [row] = await db.$queryRaw<{ changed: number }[]>(Prisma.sql`
    SELECT public.wp20_metric_report_finish(${scope.vendorId},${scope.liveId},${scope.versionId},${scope.reportId},${scope.workerId},
      ${JSON.stringify(aggregate)}::jsonb) AS changed`);
  return row?.changed === 1;
}
