import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureProductEvent } from "./product-analytics";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "test-fixture-posthog-key");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://posthog.example.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("captureProductEvent", () => {
  it("uses a bounded provider request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(captureProductEvent({
      distinctId: "visitor-1",
      event: "page_view",
      properties: { vendorId: "vendor-1", liveId: "live-1", slug: "demo" },
    })).resolves.toEqual({ skipped: false });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://posthog.example.test/capture/",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not expose provider response bodies in rejection errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      "visitor-email-and-provider-detail",
      { status: 429 },
    )));

    const promise = captureProductEvent({ distinctId: "visitor-1", event: "page_view" });
    await expect(promise).rejects.toThrow("provider_rejected:429");
    await expect(promise).rejects.not.toThrow("visitor-email-and-provider-detail");
  });

  it("maps transport failures to a generic category", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("request detail with key")));

    await expect(captureProductEvent({
      distinctId: "visitor-1",
      event: "page_view",
    })).rejects.toThrow("PostHog capture failed (network).");
  });
});
