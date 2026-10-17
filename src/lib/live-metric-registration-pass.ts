import { z } from "zod";
import { MetricRegistrationReconcileRequest } from "./live-metric-registration-reconcile";

const count = z.number().int().min(0).max(20);
const Receipt = z.object({ status: z.enum(["batch_complete", "budget_exhausted"]),
  processed: count, retryable: count, terminalGaps: count,
  outcomes: z.record(z.string(), count), nextSubmissionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable(),
  hasMore: z.boolean(), coverage: z.literal("unknown") }).strict();
type Input = z.infer<typeof MetricRegistrationReconcileRequest>;
type SendPage = (input: Input, signal: AbortSignal) => Promise<unknown>;

/** One bounded scheduler pass. Transport supplies authentication and a reviewed
 * target; this module never discovers hosts or credentials. Resume at the last
 * acknowledged cursor after failures; start from null on a later full pass.
 */
export async function runMetricRegistrationPass(sendPage: SendPage, input: Input, maxPages = 5) {
  const request = MetricRegistrationReconcileRequest.parse(input);
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10) throw new Error("Invalid page budget");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("Pass deadline")); }, 60000);
  });
  let pages = 0, processed = 0, retryable = 0, terminalGaps = 0;
  let cursor = request.afterSubmissionId;
  const seen = new Set<string>(); if (cursor !== null) seen.add(cursor);
  const result = (status: "pass_complete" | "page_limit" | "transport_unavailable" | "invalid_receipt" | "no_progress" | "deadline") =>
    ({ status, pages, processed, retryable, terminalGaps, nextSubmissionId: cursor, coverage: "unknown" as const });
  try {
    while (pages < maxPages) {
      let raw: unknown;
      try { raw = await Promise.race([sendPage({ ...request, afterSubmissionId: cursor }, controller.signal), deadline]); }
      catch { return result(controller.signal.aborted ? "deadline" : "transport_unavailable"); }
      const parsed = Receipt.safeParse(raw);
      if (!parsed.success) return result("invalid_receipt");
      const page = parsed.data;
      // Exhausting the batch budget necessarily leaves unprocessed candidates.
      // Reject contradictory completion claims before acknowledging any cursor.
      if ((page.status === "budget_exhausted" && (!page.hasMore || page.processed >= request.take))
        || (page.status === "batch_complete" && page.hasMore && page.processed !== request.take)
        || (page.outcomes.recorded ?? 0) !== page.processed - page.retryable - page.terminalGaps
        || page.processed > request.take || page.retryable + page.terminalGaps > page.processed
        || Object.values(page.outcomes).reduce((sum, n) => sum+n, 0) !== page.processed
        || (page.processed === 0 && page.nextSubmissionId !== cursor)) return result("invalid_receipt");
      if (page.processed > 0 && (page.nextSubmissionId === null || seen.has(page.nextSubmissionId))) return result("no_progress");
      pages++; processed += page.processed; retryable += page.retryable; terminalGaps += page.terminalGaps;
      cursor = page.nextSubmissionId; if (cursor !== null) seen.add(cursor);
      if (!page.hasMore) return result("pass_complete");
      if (page.processed === 0) return result("no_progress");
    }
    return result("page_limit");
  } finally { clearTimeout(timer); controller.abort(); }
}
