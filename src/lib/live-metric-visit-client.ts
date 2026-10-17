import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Prepare = z.object({ ok: z.literal(true), prepared: z.literal(true), versionId: id }).strict();
const Receipt = z.object({ ok: z.literal(true), eventId: z.string().uuid(), versionId: id }).strict();
export type MetricVisitClientResult = { status: "recorded"; versionId: string } | { status: "unavailable"; retryable: boolean };
export type MetricVisitLock = <T>(name: string, signal: AbortSignal, run: () => Promise<T>) => Promise<T>;

/** One instance per logical page visit. Keep the instance for retries; creating
 * a new one allocates a different event. Proofs remain in browser-managed
 * HttpOnly cookies, never localStorage or JavaScript-readable state.
 */
export function createMetricVisitClient(vendorId: string, liveId: string, options: {
  fetcher?: typeof fetch; lock?: MetricVisitLock; eventId?: string; timeoutMs?: number;
} = {}) {
  const scope = [id.parse(vendorId), id.parse(liveId)];
  const eventId = z.string().uuid().parse(options.eventId ?? crypto.randomUUID());
  const timeoutMs = options.timeoutMs ?? 15000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error("Invalid metric timeout");
  const fetcher = options.fetcher ?? fetch;
  const lock: MetricVisitLock | undefined = options.lock ?? (typeof navigator !== "undefined" && navigator.locks
    ? async (name, signal, run) => await navigator.locks.request(name, { mode: "exclusive", signal }, run)
    : undefined);
  const endpoint = `/api/live-metrics/${scope[0]}/${scope[1]}/visits`;
  const lockName = `cd-metric-visit:${JSON.stringify(scope)}`;
  let inFlight: Promise<MetricVisitClientResult> | null = null;
  let recorded: MetricVisitClientResult | null = null;
  let versionId: string | null = null;

  async function attempt(): Promise<MetricVisitClientResult> {
    if (!lock) return { status: "unavailable", retryable: false };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const unavailable = (status: number): MetricVisitClientResult => ({ status: "unavailable", retryable: status === 429 || status >= 500 });
    async function post(body: unknown) {
      return fetcher(endpoint, { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-CelebrateDeal-Client": "web" },
        body: JSON.stringify(body), signal: controller.signal });
    }
    try {
      return await lock(lockName, controller.signal, async () => {
        // Each tab rechecks the cookie only after acquiring the origin-wide lock.
        const preparation = await post({ action: "prepare", eventId });
        if (!preparation.ok) return unavailable(preparation.status);
        const prepared = Prepare.safeParse(await preparation.json());
        if (!prepared.success) return { status: "unavailable", retryable: false };
        if (controller.signal.aborted) return { status: "unavailable", retryable: true };
        // A lost acknowledgement must not cause one event to cross versions.
        if (versionId !== null && versionId !== prepared.data.versionId) return { status: "unavailable", retryable: false };
        versionId = prepared.data.versionId;
        const response = await post({ action: "visit", eventId });
        if (!response.ok) return unavailable(response.status);
        const receipt = Receipt.safeParse(await response.json());
        if (!receipt.success || receipt.data.eventId !== eventId || receipt.data.versionId !== versionId) return { status: "unavailable", retryable: false };
        recorded = { status: "recorded", versionId };
        return recorded;
      });
    } catch {
      return { status: "unavailable", retryable: true };
    } finally { clearTimeout(timer); }
  }
  return {
    collect(): Promise<MetricVisitClientResult> {
      if (recorded) return Promise.resolve(recorded);
      if (inFlight) return inFlight;
      inFlight = Promise.resolve().then(attempt).finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
