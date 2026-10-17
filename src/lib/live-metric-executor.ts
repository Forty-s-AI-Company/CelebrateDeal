import { Worker } from "node:worker_threads";
import type { CoreMetrics, CoreMetricsInput, CompletionProjection, CompletionProjectionInput } from "./live-core-metrics-read-model";

export type MetricExecution = { status: "available"; metrics: CoreMetrics }
  | { status: "unavailable"; reason: "busy" | "input_limit" | "timeout" | "worker_failed" };

/** The job runner supplies the trusted build artifact, never a request URL.
 * One calculation per executor; do not queue unbounded payloads in memory.
 * No synchronous fallback: worker failure must not block the web event loop.
 */
export function createMetricExecutor(artifact: URL, timeoutMs = 20000) {
  const execute = createBoundedExecutor<CoreMetrics>(artifact, "metrics", timeoutMs);
  return async (input: CoreMetricsInput): Promise<MetricExecution> => {
    const result = await execute(input);
    return result.status === "available" ? { status: "available", metrics: result.value } : result;
  };
}
export type CompletionExecution = { status: "available"; projection: CompletionProjection }
  | { status: "unavailable"; reason: "busy" | "input_limit" | "timeout" | "worker_failed" };

/** Projection remains a candidate until a revision-checked atomic DB write. */
export function createCompletionExecutor(artifact: URL, timeoutMs = 20000) {
  const execute = createBoundedExecutor<CompletionProjection>(artifact, "completion", timeoutMs);
  return async (input: CompletionProjectionInput): Promise<CompletionExecution> => {
    const result = await execute({ ...input, visits: null, completions: null, orders: null });
    return result.status === "available" ? { status: "available", projection: result.value } : result;
  };
}
type BoundedResult<T> = { status: "available"; value: T }
  | { status: "unavailable"; reason: "busy" | "input_limit" | "timeout" | "worker_failed" };
function createBoundedExecutor<T>(artifact: URL, operation: "metrics" | "completion", timeoutMs: number) {
  if (artifact.protocol !== "file:" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error("Invalid metric executor configuration");
  let active = false;
  return async (input: CoreMetricsInput): Promise<BoundedResult<T>> => {
    if (active) return { status: "unavailable", reason: "busy" };
    const lists = [input.visits, input.registrations, input.viewing, input.completions, input.orders];
    if (lists.some(rows => rows !== null && !Array.isArray(rows))
      || lists.reduce((sum, rows) => sum + (rows?.length ?? 0), 0) > 1_000_000) return { status: "unavailable", reason: "input_limit" };
    active = true;
    try {
      return await new Promise<BoundedResult<T>>(resolve => {
        let worker: Worker;
        try {
          worker = new Worker(artifact, { workerData: { operation, input }, env: {}, execArgv: [], stdout: true, stderr: true,
            resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } });
        } catch { resolve({ status: "unavailable", reason: "worker_failed" }); return; }
        // Consume and discard worker diagnostics; raw facts never enter logs.
        worker.stdout?.resume(); worker.stderr?.resume();
        let settled = false;
        const finish = (result: BoundedResult<T>) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          void worker.terminate().catch(() => undefined).then(() => resolve(result));
        };
        const timer = setTimeout(() => finish({ status: "unavailable", reason: "timeout" }), timeoutMs);
        worker.once("message", (value: T) => finish({ status: "available", value }));
        worker.once("error", () => finish({ status: "unavailable", reason: "worker_failed" }));
        worker.once("exit", () => finish({ status: "unavailable", reason: "worker_failed" }));
      });
    } finally { active = false; }
  };
}
