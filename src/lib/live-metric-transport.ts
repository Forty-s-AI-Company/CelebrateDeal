import { z } from "zod";
import type { MetricDeliveryTransport } from "./live-metric-delivery";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const sequence = z.number().int().min(-1).max(2_147_483_647);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sessionSchema = z.object({ ok: z.literal(true), sessionId: id, versionId: id,
  serverNowAtMs: timestamp, anchorAtMs: timestamp, expiresAtMs: timestamp, durationMs: timestamp.nullable(),
  lastSequence: sequence, lastElapsedMs: timestamp,
}).refine((value) => value.expiresAtMs > value.serverNowAtMs && value.serverNowAtMs >= value.anchorAtMs);
const appendSchema = z.object({ ok: z.literal(true), lastSequence: sequence,
  accepted: z.number().int().nonnegative(), replayed: z.number().int().nonnegative() });
const closeSchema = z.object({ ok: z.literal(true), sessionId: id, finalSequence: sequence,
  lastSequence: sequence, deliveryComplete: z.boolean(), appendOpen: z.boolean(), closedAtMs: timestamp.nullable() });

/** Relative same-origin endpoints only. Credentials stay in the browser's
 * cookie handling; never read, persist or expose them to the collector.
 */
export function createMetricHttpTransport(vendorId: string, liveId: string, fetcher: typeof fetch = fetch) {
  const base = `/api/live-metrics/${id.parse(vendorId)}/${id.parse(liveId)}`;
  async function post(path: string, body: unknown) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetcher(`${base}/${path}`, { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-CelebrateDeal-Client": "web" },
        body: JSON.stringify(body), signal: controller.signal, keepalive: true });
      const responseBody: unknown = response.ok ? await response.json() : null;
      return { ok: response.ok, status: response.status, body: responseBody };
    } finally { clearTimeout(timer); }
  }
  return {
    async open(requestId: string) {
      z.string().uuid().parse(requestId);
      const response = await post("sessions", { requestId });
      if (response.status === 429 || response.status >= 500) throw new Error("Metric issuance temporarily unavailable");
      if (!response.ok) return null;
      const parsed = sessionSchema.safeParse(response.body);
      return parsed.success ? parsed.data : null;
    },
    session(sessionId: string): MetricDeliveryTransport {
      id.parse(sessionId);
      return {
        async append(segments) {
          const response = await post("intervals", { sessionId, segments });
          if (!response.ok) return { ok: false, retryable: response.status === 429 || response.status >= 500 };
          const parsed = appendSchema.safeParse(response.body);
          if (!parsed.success || parsed.data.accepted + parsed.data.replayed !== segments.length) return { ok: false, retryable: false };
          return { ok: true, lastSequence: parsed.data.lastSequence };
        },
        async close(finalSequence) {
          const response = await post("close", { sessionId, finalSequence });
          if (!response.ok) return { terminal: false };
          const parsed = closeSchema.safeParse(response.body);
          if (!parsed.success || parsed.data.sessionId !== sessionId || parsed.data.finalSequence !== finalSequence) return { terminal: false };
          const receipt = parsed.data;
          return { terminal: !receipt.appendOpen && receipt.closedAtMs !== null };
        },
      };
    },
  };
}
