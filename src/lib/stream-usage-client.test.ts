import { describe, expect, it, vi } from "vitest";
import { postStreamUsageHeartbeat } from "@/lib/stream-usage-client";

const heartbeat = {
  vendorId: "vendor-1",
  liveId: "live-1",
  sourcePageSlug: "partner-page",
  eventId: "00000000-0000-4000-8000-000000000001",
  watchSeconds: 60,
};

describe("postStreamUsageHeartbeat", () => {
  it("sends the bounded server attribution payload with the browser marker", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(postStreamUsageHeartbeat(heartbeat, fetcher)).resolves.toBe("recorded");
    expect(fetcher).toHaveBeenCalledWith("/api/stream-usage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CelebrateDeal-Client": "web",
      },
      body: JSON.stringify(heartbeat),
      signal: expect.any(AbortSignal),
    });
  });

  it("does not treat non-success responses as recorded usage", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 409 }));

    await expect(postStreamUsageHeartbeat(heartbeat, fetcher)).resolves.toBe("retryable_failure");
  });

  it("only classifies the stable quota response as exhausted", async () => {
    const exhausted = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Stream quota exhausted", code: "stream_minutes_exhausted" }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    ));
    const genericRateLimit = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Too many requests" }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    ));

    await expect(postStreamUsageHeartbeat(heartbeat, exhausted)).resolves.toBe("quota_exhausted");
    await expect(postStreamUsageHeartbeat(heartbeat, genericRateLimit)).resolves.toBe("retryable_failure");
  });

  it("fails closed when the browser cannot reach the usage endpoint", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network unavailable"));

    await expect(postStreamUsageHeartbeat(heartbeat, fetcher)).resolves.toBe("retryable_failure");
  });

  it("times out a permanently pending request and aborts its fetch signal", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });

    const outcome = postStreamUsageHeartbeat(heartbeat, fetcher, { timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);

    await expect(outcome).resolves.toBe("retryable_failure");
    expect(requestSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("honors caller cancellation even when the fetcher ignores AbortSignal", async () => {
    const caller = new AbortController();
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined));
    const outcome = postStreamUsageHeartbeat(heartbeat, fetcher, {
      signal: caller.signal,
      timeoutMs: 10_000,
    });

    caller.abort(new Error("component unmounted"));

    await expect(outcome).resolves.toBe("retryable_failure");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
