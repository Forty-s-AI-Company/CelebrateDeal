export type StreamUsageHeartbeat = {
  vendorId: string;
  liveId: string;
  sourcePageSlug?: string | null;
  liveShareCode?: string | null;
  eventId: string;
  watchSeconds: number;
};

export type StreamUsageHeartbeatOutcome = "recorded" | "quota_exhausted" | "retryable_failure";

export const STREAM_USAGE_HEARTBEAT_TIMEOUT_MS = 2_000;

type StreamUsageHeartbeatRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

function isQuotaExhaustedResponse(value: unknown): value is { code: "stream_minutes_exhausted" } {
  return typeof value === "object"
    && value !== null
    && "code" in value
    && value.code === "stream_minutes_exhausted";
}

/** Sends one bounded playback heartbeat without persisting a visitor identifier. */
export async function postStreamUsageHeartbeat(
  input: StreamUsageHeartbeat,
  fetcher: typeof fetch = fetch,
  options: StreamUsageHeartbeatRequestOptions = {},
): Promise<StreamUsageHeartbeatOutcome> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? STREAM_USAGE_HEARTBEAT_TIMEOUT_MS;
  const forwardAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) forwardAbort();
  else options.signal?.addEventListener("abort", forwardAbort, { once: true });

  const timeout = setTimeout(() => controller.abort(new Error("Stream usage heartbeat timed out")), timeoutMs);
  const aborted = new Promise<never>((_resolve, reject) => {
    const rejectOnAbort = () => reject(controller.signal.reason ?? new Error("Stream usage heartbeat aborted"));
    if (controller.signal.aborted) rejectOnAbort();
    else controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
  });

  try {
    const response = await Promise.race([
      fetcher("/api/stream-usage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CelebrateDeal-Client": "web",
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      }),
      aborted,
    ]);
    if (response.ok) return "recorded";
    if (response.status === 429) {
      const payload = await response.json().catch(() => null) as unknown;
      if (isQuotaExhaustedResponse(payload)) return "quota_exhausted";
    }
    return "retryable_failure";
  } catch {
    return "retryable_failure";
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}
