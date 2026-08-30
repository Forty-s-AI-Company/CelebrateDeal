import { describe, expect, it } from "vitest";

import { assertStreamQuotaAvailable, assertStreamScopedQuotasAvailable, streamQuotaNotification, StreamQuotaExceededError } from "@/lib/stream-quota";

describe("stream quota enforcement", () => {
  it("allows usage exactly at the included-minute boundary", () => {
    expect(() => assertStreamQuotaAvailable({ includedMinutes: 1, usedSeconds: 30, requestedSeconds: 30 })).not.toThrow();
  });

  it("fails when a request crosses the included-minute boundary", () => {
    expect(() => assertStreamQuotaAvailable({ includedMinutes: 1, usedSeconds: 30, requestedSeconds: 31 }))
      .toThrowError(StreamQuotaExceededError);
  });

  it("preserves legacy behavior for an unconfigured non-positive limit", () => {
    expect(() => assertStreamQuotaAvailable({ includedMinutes: 0, usedSeconds: 10_000, requestedSeconds: 60 })).not.toThrow();
  });

  it("enforces the allocated seconds for a configured member quota", () => {
    expect(() => assertStreamScopedQuotasAvailable({
      memberQuotas: [{ teamId: "team-1", membershipId: "member-1", includedMinutes: 1 }],
      pageQuotas: [],
      sourcePageId: null,
      currentMemberUsage: new Map([["team-1:member-1", 30]]),
      currentPageUsageSeconds: 0,
      requestedWatchSeconds: 45,
      requestedAllocations: [{ recipientTeamId: "team-1", recipientMembershipId: "member-1", allocatedWatchSeconds: 31 }],
    })).toThrowError(StreamQuotaExceededError);
  });

  it("enforces the full heartbeat against a configured page quota", () => {
    expect(() => assertStreamScopedQuotasAvailable({
      memberQuotas: [],
      pageQuotas: [{ pageId: "page-1", includedMinutes: 1 }],
      sourcePageId: "page-1",
      currentMemberUsage: new Map(),
      currentPageUsageSeconds: 30,
      requestedWatchSeconds: 31,
      requestedAllocations: [],
    })).toThrowError(StreamQuotaExceededError);
  });

  it("returns deterministic in-app warning and exhausted notifications", () => {
    expect(streamQuotaNotification({ used: 79, limit: 100 })).toBeNull();
    expect(streamQuotaNotification({ used: 80, limit: 100 })).toContain("已達 80%");
    expect(streamQuotaNotification({ used: 100, limit: 100 })).toContain("新播放已暫停");
    expect(streamQuotaNotification({ used: 100, limit: 0 })).toBeNull();
  });
});
