import { describe, expect, it } from "vitest";
import { convergeCloudflareVideoTransition } from "@/lib/cloudflare-video-transition";

describe("convergeCloudflareVideoTransition", () => {
  it("re-reads after an error-first CAS miss and converges a later ready event", async () => {
    let storedStatus = "processing";
    const claims: Array<{ expectedStatus: string; nextStatus: string }> = [];

    const result = await convergeCloudflareVideoTransition({
      snapshot: { id: "video-1", status: "processing" },
      incomingStatus: "ready",
      claim: async ({ expectedStatus, nextStatus }) => {
        claims.push({ expectedStatus, nextStatus });
        if (claims.length === 1) {
          storedStatus = "error";
          return false;
        }
        if (storedStatus !== expectedStatus) return false;
        storedStatus = nextStatus;
        return true;
      },
      readLatest: async () => ({ id: "video-1", status: storedStatus }),
    });

    expect(result).toEqual({ outcome: "applied" });
    expect(storedStatus).toBe("ready");
    expect(claims).toEqual([
      { expectedStatus: "processing", nextStatus: "ready" },
      { expectedStatus: "error", nextStatus: "ready" },
    ]);
  });

  it("keeps ready terminal when a late error event loses its claim", async () => {
    const result = await convergeCloudflareVideoTransition({
      snapshot: { id: "video-2", status: "processing" },
      incomingStatus: "error",
      claim: async () => false,
      readLatest: async () => ({ id: "video-2", status: "ready" }),
    });

    expect(result).toEqual({ outcome: "stale_or_idempotent" });
  });

  it("allows a duplicate ready event without state regression", async () => {
    let status = "ready";
    const result = await convergeCloudflareVideoTransition({
      snapshot: { id: "video-3", status },
      incomingStatus: "ready",
      claim: async ({ expectedStatus, nextStatus }) => {
        if (status !== expectedStatus) return false;
        status = nextStatus;
        return true;
      },
      readLatest: async () => ({ id: "video-3", status }),
    });

    expect(result).toEqual({ outcome: "applied" });
    expect(status).toBe("ready");
  });

  it("reports a deleted mapping without retrying indefinitely", async () => {
    const result = await convergeCloudflareVideoTransition({
      snapshot: { id: "video-4", status: "processing" },
      incomingStatus: "ready",
      claim: async () => false,
      readLatest: async () => null,
    });

    expect(result).toEqual({ outcome: "missing" });
  });

  it("returns a fixed exhaustion outcome after the configured CAS bound", async () => {
    let claims = 0;
    const result = await convergeCloudflareVideoTransition({
      snapshot: { id: "video-5", status: "processing" },
      incomingStatus: "ready",
      maxAttempts: 3,
      claim: async () => {
        claims += 1;
        return false;
      },
      readLatest: async () => ({ id: "video-5", status: "processing" }),
    });

    expect(result).toEqual({ outcome: "contention_exhausted" });
    expect(claims).toBe(3);
  });
});
