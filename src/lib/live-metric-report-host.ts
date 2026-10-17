import { performance } from "node:perf_hooks";
import { setTimeout as wait } from "node:timers/promises";
import { z } from "zod";
import { enqueueMetricReport } from "./live-metric-report-queue";
import { runMetricReportSchedulerTick } from "./live-metric-report-scheduler";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const date = z.string().datetime({ offset: true }).transform(value => new Date(value));
const Entry = z.object({ vendorId: id, liveId: id, versionId: id, startAt: date, endAt: date,
  retentionSeconds: z.number().int().min(1).max(86400).default(3600) }).strict()
  .refine(value => +value.startAt >= 0 && value.startAt < value.endAt, "Invalid host window");
const Config = z.object({ entries: z.array(Entry).min(1).max(16),
  cadenceMilliseconds: z.number().int().min(1000).max(3600000).default(60000),
  maxCycles: z.number().int().min(1).max(10000).default(1),
  jobsPerCycle: z.number().int().min(1).max(4).default(1),
  admissionMilliseconds: z.number().int().min(1).max(60000).default(45000) }).strict()
  .refine(value => new Set(value.entries.map(entry => JSON.stringify(entry))).size === value.entries.length, "Duplicate host entry");
type Database = Parameters<typeof runMetricReportSchedulerTick>[0];
type Execute = Parameters<typeof runMetricReportSchedulerTick>[2];
type Project = Parameters<typeof runMetricReportSchedulerTick>[3];
type Cycle = { cycle: number; partial: boolean; created: number; reused: number; denied: number; contention: number; attempted: number; recorded: number };
const scopeKey = (entry: { vendorId: string; liveId: string; versionId: string }) => JSON.stringify([entry.vendorId, entry.liveId, entry.versionId]);
function rotate<T>(rows: T[], offset: number) { const start = offset % rows.length; return [...rows.slice(start), ...rows.slice(0, start)]; }

/** Private process-owned host, with no HTTP listener or request-selected scope.
 * Config grants the listed vendor/live/version scopes, including already queued
 * windows in those scopes; its fixed windows are the ONLY new work it creates.
 * The launcher owns nonproduction DB admission and trusted worker artifacts.
 * One cycle at a time, no catch-up bursts, no new work after stop. An in-flight
 * DB transaction/worker retains its bounded lease and is awaited before exit.
 */
export function createMetricReportHost(db: Database, value: unknown, execute: Execute, project?: Project) {
  const config = Config.parse(value);
  const scopes = [...new Map(config.entries.map(entry => [scopeKey(entry), {
    vendorId: entry.vendorId, liveId: entry.liveId, versionId: entry.versionId,
  }])).values()];
  let running = false;
  async function run(signal: AbortSignal, observe: (value: Readonly<Cycle>) => void = () => undefined) {
    if (running) throw new Error("Metric host already running");
    running = true;
    let cycles = 0, created = 0, recorded = 0;
    let completedFinalCycle = false;
    try {
      for (let index = 0; index < config.maxCycles && !signal.aborted; index++) {
        const started = performance.now();
        const result: Cycle = { cycle: index + 1, partial: false, created: 0, reused: 0, denied: 0, contention: 0, attempted: 0, recorded: 0 };
        const admitted = () => !signal.aborted && performance.now() - started < config.admissionMilliseconds;
        for (const entry of rotate(config.entries, index)) {
          if (!admitted()) { result.partial = true; break; }
          const queued = await enqueueMetricReport(db, entry);
          if (queued.status === "available") { if (queued.created) { result.created++; created++; } else result.reused++; }
          else if (queued.reason === "contention") result.contention++;
          else if (queued.reason === "integrity_violation" || queued.reason === "enqueue_failed")
            return { status: "halted" as const, reason: queued.reason, cycles, created, recorded };
          else result.denied++;
        }
        for (const scope of rotate(scopes, index)) {
          if (result.attempted >= config.jobsPerCycle) break;
          if (!admitted()) { result.partial = true; break; }
          const tick = await runMetricReportSchedulerTick(db, scope, execute, project, {
            jobs: config.jobsPerCycle - result.attempted,
            admissionMilliseconds: Math.max(1, Math.floor(config.admissionMilliseconds - (performance.now() - started))),
          }, signal);
          if (tick.status === "unavailable") return { status: "halted" as const, reason: "selection_failed" as const, cycles, created, recorded };
          result.attempted += tick.attempted; result.recorded += tick.outcomes.recorded; recorded += tick.outcomes.recorded;
          if (tick.deferred > 0 && result.attempted < config.jobsPerCycle && !admitted()) result.partial = true;
        }
        completedFinalCycle = index + 1 === config.maxCycles && !result.partial;
        cycles++;
        // Only aggregate counters leave the host. The observer cannot mutate
        // configuration, cumulative counters or in-flight DB/worker payloads.
        observe(Object.freeze({ ...result }));
        if (index + 1 < config.maxCycles && !signal.aborted) {
          try { await wait(config.cadenceMilliseconds, undefined, { signal }); }
          catch (error) { if (!signal.aborted) throw error; }
        }
      }
      return { status: signal.aborted && !completedFinalCycle ? "stopped" as const : "completed" as const, cycles, created, recorded };
    } catch {
      return { status: "halted" as const, reason: "unexpected_error" as const, cycles, created, recorded };
    } finally { running = false; }
  }
  return { run };
}
