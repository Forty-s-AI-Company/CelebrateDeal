import { parentPort, workerData } from "node:worker_threads";
import { calculateCoreMetrics, calculateCompletionProjection, type CoreMetricsInput } from "./live-core-metrics-read-model";

// Built as a standalone CommonJS artifact. No DB, environment, credentials or
// network clients are imported into the calculation thread.
if (!parentPort) throw new Error("Metric calculation requires a worker thread");
const request = workerData as { operation: "metrics" | "completion"; input: CoreMetricsInput };
if (request.operation !== "metrics" && request.operation !== "completion") throw new Error("Unknown metric worker operation");
parentPort.postMessage(request.operation === "completion"
  ? calculateCompletionProjection(request.input) : calculateCoreMetrics(request.input));
