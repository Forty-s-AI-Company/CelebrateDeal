export type MetricPlaybackReceipt = { metricRequestId: string; metricIssuedAtMs: number; metricExpiresAtMs: number };

/** Optional untrusted HTTP metadata. Invalid/missing tracking never manufactures
 * a local identity, nor does it prevent the existing playback URL being used.
 */
export function metricPlaybackReceipt(value: unknown): MetricPlaybackReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const { metricRequestId, metricIssuedAtMs, metricExpiresAtMs } = candidate;
  if (typeof metricRequestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(metricRequestId)
    || typeof metricIssuedAtMs !== "number" || !Number.isSafeInteger(metricIssuedAtMs) || metricIssuedAtMs < 0
    || typeof metricExpiresAtMs !== "number" || !Number.isSafeInteger(metricExpiresAtMs) || metricExpiresAtMs <= metricIssuedAtMs) return null;
  return { metricRequestId: metricRequestId.toLowerCase(), metricIssuedAtMs, metricExpiresAtMs };
}
