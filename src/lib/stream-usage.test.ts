import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  liveFindFirst: vi.fn(),
  entryFindUnique: vi.fn(),
  entryCreate: vi.fn(),
  ledgerAggregate: vi.fn(),
  streamUsageAllocationGroupBy: vi.fn(),
  usageLimitFindUnique: vi.fn(),
  alertUpsert: vi.fn(),
  alertUpdateMany: vi.fn(),
  transaction: vi.fn(),
  resolveTeamFunnelAttribution: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    live: { findFirst: mocks.liveFindFirst },
    $transaction: mocks.transaction,
    streamUsageLedgerEntry: {
      findUnique: mocks.entryFindUnique,
      create: mocks.entryCreate,
      aggregate: mocks.ledgerAggregate,
      groupBy: mocks.streamUsageAllocationGroupBy,
    },
    streamUsageAllocationEntry: { groupBy: mocks.streamUsageAllocationGroupBy },
    vendorUsageLimit: { findUnique: mocks.usageLimitFindUnique },
    streamOperationsAlert: { upsert: mocks.alertUpsert, updateMany: mocks.alertUpdateMany },
  }),
}));
vi.mock("@/lib/team-funnel-attribution", () => ({
  resolveTeamFunnelAttribution: mocks.resolveTeamFunnelAttribution,
}));

import {
  recordStreamUsageLedgerEntry,
  StreamUsageValidationError,
} from "@/lib/stream-usage";

const capturedAt = new Date("2026-07-15T12:34:56.000Z");
const directInput = {
  vendorId: "vendor-1",
  liveId: "live-1",
  eventId: "00000000-0000-4000-8000-000000000001",
  watchSeconds: 45,
  capturedAt,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.liveFindFirst.mockResolvedValue({ id: "live-1", teamId: null, seminarOwnerMembershipId: null, quotaPolicy: null });
  mocks.entryFindUnique.mockResolvedValue(null);
  mocks.entryCreate.mockResolvedValue({ id: "usage-1", source: "DIRECT_PLAYBACK" });
  mocks.ledgerAggregate.mockResolvedValue({ _sum: { watchSeconds: 0 } });
  mocks.streamUsageAllocationGroupBy.mockResolvedValue([]);
  mocks.usageLimitFindUnique.mockResolvedValue(null);
  mocks.alertUpsert.mockResolvedValue({ id: "alert-1" });
  mocks.alertUpdateMany.mockResolvedValue({ count: 0 });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    streamUsageLedgerEntry: {
      findUnique: mocks.entryFindUnique,
      create: mocks.entryCreate,
      aggregate: mocks.ledgerAggregate,
      groupBy: mocks.streamUsageAllocationGroupBy,
    },
    streamUsageAllocationEntry: { groupBy: mocks.streamUsageAllocationGroupBy },
    vendorUsageLimit: { findUnique: mocks.usageLimitFindUnique },
    streamOperationsAlert: { upsert: mocks.alertUpsert, updateMany: mocks.alertUpdateMany },
  }));
  mocks.resolveTeamFunnelAttribution.mockResolvedValue(null);
});

describe("recordStreamUsageLedgerEntry", () => {
  it("rejects invalid event identity and duration before database access", async () => {
    await expect(recordStreamUsageLedgerEntry({ ...directInput, eventId: "not-an-uuid" })).rejects.toMatchObject({
      code: "invalid_event",
    });
    await expect(recordStreamUsageLedgerEntry({ ...directInput, watchSeconds: 61 })).rejects.toMatchObject({
      code: "invalid_duration",
    });
    expect(mocks.liveFindFirst).not.toHaveBeenCalled();
  });

  it("rejects a heartbeat that would exceed the included stream-minute quota", async () => {
    mocks.usageLimitFindUnique.mockResolvedValueOnce({
      streamMinutesLimit: 1,
      streamMinutesUsed: 0,
      resetAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    mocks.ledgerAggregate.mockResolvedValueOnce({ _sum: { watchSeconds: 30 } });

    await expect(recordStreamUsageLedgerEntry({ ...directInput, watchSeconds: 45 }))
      .rejects.toMatchObject({ code: "stream_minutes_exhausted" });

    expect(mocks.entryCreate).not.toHaveBeenCalled();
  });

  it("opens one persistent warning after a successful heartbeat reaches 80% of a finite vendor quota", async () => {
    mocks.usageLimitFindUnique.mockResolvedValueOnce({
      streamMinutesLimit: 10,
      streamMinutesUsed: 0,
      resetAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    mocks.ledgerAggregate.mockResolvedValueOnce({ _sum: { watchSeconds: 435 } });

    await recordStreamUsageLedgerEntry(directInput);

    expect(mocks.alertUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { dedupKey: "stream-quota-warning:vendor-1:2026-07" },
      create: expect.objectContaining({
        type: "QUOTA_WARNING",
        severity: "WARNING",
        message: "串流分鐘用量已達方案額度 80%，請留意剩餘可用時數。",
        metadata: { usedSeconds: 480, limitSeconds: 600 },
      }),
    }));
    expect(mocks.alertUpdateMany).not.toHaveBeenCalled();
  });

  it("opens exhausted and resolves a prior warning when a successful heartbeat reaches the quota", async () => {
    mocks.usageLimitFindUnique.mockResolvedValueOnce({
      streamMinutesLimit: 2,
      streamMinutesUsed: 0,
      resetAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    mocks.ledgerAggregate.mockResolvedValueOnce({ _sum: { watchSeconds: 75 } });

    await recordStreamUsageLedgerEntry(directInput);

    expect(mocks.alertUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { dedupKey: "stream-quota-exhausted:vendor-1:2026-07" },
      create: expect.objectContaining({
        type: "QUOTA_EXHAUSTED",
        severity: "CRITICAL",
        message: "串流分鐘方案額度已用盡，新的播放心跳將依額度規則拒絕。",
        metadata: { usedSeconds: 120, limitSeconds: 120 },
      }),
    }));
    expect(mocks.alertUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { dedupKey: "stream-quota-warning:vendor-1:2026-07", status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      data: expect.objectContaining({ status: "RESOLVED" }),
    }));
  });

  it("rejects a heartbeat that crosses a configured member allocation quota", async () => {
    mocks.liveFindFirst.mockResolvedValueOnce({
      id: "live-1",
      teamId: "team-1",
      seminarOwnerMembershipId: "owner-1",
      quotaPolicy: {
        usageAttributionMode: "PROMOTER",
        memberQuotas: [{ teamId: "team-1", membershipId: "member-1", includedMinutes: 1 }],
      },
    });
    mocks.resolveTeamFunnelAttribution.mockResolvedValueOnce({
      sourcePageId: "page-1",
      teamId: "team-1",
      templateVersionId: "version-1",
      promoterMembershipId: "member-1",
      contentOwnerMembershipId: "owner-1",
    });
    mocks.streamUsageAllocationGroupBy.mockResolvedValueOnce([{
      recipientTeamId: "team-1",
      recipientMembershipId: "member-1",
      _sum: { allocatedWatchSeconds: 30 },
    }]);

    await expect(recordStreamUsageLedgerEntry({ ...directInput, sourcePageSlug: "partner-page", watchSeconds: 31 }))
      .rejects.toMatchObject({ code: "stream_minutes_exhausted" });
    expect(mocks.entryCreate).not.toHaveBeenCalled();
  });

  it("rejects a heartbeat that crosses a configured page quota", async () => {
    mocks.liveFindFirst.mockResolvedValueOnce({
      id: "live-1",
      teamId: "team-1",
      seminarOwnerMembershipId: "owner-1",
      quotaPolicy: {
        usageAttributionMode: "PROMOTER",
        pageQuotas: [{ pageId: "page-1", includedMinutes: 1 }],
      },
    });
    mocks.resolveTeamFunnelAttribution.mockResolvedValueOnce({
      sourcePageId: "page-1",
      teamId: "team-1",
      templateVersionId: "version-1",
      promoterMembershipId: "member-1",
      contentOwnerMembershipId: "owner-1",
    });
    mocks.ledgerAggregate.mockResolvedValueOnce({ _sum: { watchSeconds: 30 } });

    await expect(recordStreamUsageLedgerEntry({ ...directInput, sourcePageSlug: "partner-page", watchSeconds: 31 }))
      .rejects.toMatchObject({ code: "stream_minutes_exhausted" });
    expect(mocks.entryCreate).not.toHaveBeenCalled();
  });

  it("stores direct playback with a server-captured month and no visitor identity", async () => {
    await expect(recordStreamUsageLedgerEntry(directInput)).resolves.toEqual({
      duplicate: false,
      entryId: "usage-1",
      source: "DIRECT_PLAYBACK",
    });

    expect(mocks.entryCreate).toHaveBeenCalledWith({
      data: {
        vendorId: "vendor-1",
        liveId: "live-1",
        sourcePageId: null,
        teamId: null,
        templateVersionId: null,
        promoterMembershipId: null,
        contentOwnerMembershipId: null,
        eventId: directInput.eventId,
        monthKey: "2026-07",
        watchSeconds: 45,
        source: "DIRECT_PLAYBACK",
        policyVersion: 2,
        attributionMode: "PROMOTER",
        capturedAt,
        allocations: {
          create: [{
            vendorId: "vendor-1",
            liveId: "live-1",
            monthKey: "2026-07",
            recipientKey: "UNATTRIBUTED",
            recipientType: "UNATTRIBUTED",
            recipientTeamId: null,
            recipientMembershipId: null,
            allocationBps: 10_000,
            allocatedWatchSeconds: 45,
            policyVersion: 2,
            attributionMode: "PROMOTER",
          }],
        },
      },
      select: { id: true, source: true },
    });
  });

  it("persists the immutable Team Funnel attribution snapshot", async () => {
    mocks.resolveTeamFunnelAttribution.mockResolvedValueOnce({
      sourcePageId: "page-1",
      teamId: "team-1",
      templateVersionId: "version-1",
      promoterMembershipId: "promoter-1",
      contentOwnerMembershipId: "owner-1",
    });

    await recordStreamUsageLedgerEntry({ ...directInput, sourcePageSlug: "Partner-Page" });

    expect(mocks.resolveTeamFunnelAttribution).toHaveBeenCalledWith({
      vendorId: "vendor-1",
      liveId: "live-1",
      sourcePageSlug: "partner-page",
      referral: null,
      now: capturedAt,
    });
    expect(mocks.entryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        source: "TEAM_FUNNEL_PAGE",
        sourcePageId: "page-1",
        teamId: "team-1",
        templateVersionId: "version-1",
        promoterMembershipId: "promoter-1",
        contentOwnerMembershipId: "owner-1",
        policyVersion: 2,
        attributionMode: "PROMOTER",
        allocations: {
          create: [expect.objectContaining({
            recipientKey: "MEMBERSHIP:team-1:promoter-1",
            recipientMembershipId: "promoter-1",
            allocationBps: 10_000,
            allocatedWatchSeconds: 45,
          })],
        },
      }),
    }));
  });

  it("persists a dedicated Live share attribution without requiring a source-page slug", async () => {
    mocks.resolveTeamFunnelAttribution.mockResolvedValueOnce({
      sourcePageId: "page-a",
      teamId: "team-1",
      templateVersionId: "version-a",
      promoterMembershipId: "member-b",
      contentOwnerMembershipId: "member-a",
    });

    await recordStreamUsageLedgerEntry({ ...directInput, liveShareCode: "tls1.share-code" });

    expect(mocks.resolveTeamFunnelAttribution).toHaveBeenCalledWith({
      vendorId: "vendor-1",
      liveId: "live-1",
      sourcePageSlug: null,
      liveShareCode: "tls1.share-code",
      referral: null,
      now: capturedAt,
    });
    expect(mocks.entryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        source: "TEAM_FUNNEL_LIVE_SHARE",
        promoterMembershipId: "member-b",
        contentOwnerMembershipId: "member-a",
      }),
    }));
  });

  it("replays the same immutable event and rejects payload drift", async () => {
    mocks.entryFindUnique.mockResolvedValueOnce({
      id: "usage-1",
      vendorId: "vendor-1",
      liveId: "live-1",
      sourcePageId: null,
      teamId: null,
      templateVersionId: null,
      promoterMembershipId: null,
      contentOwnerMembershipId: null,
      eventId: directInput.eventId,
      monthKey: "2026-07",
      watchSeconds: 45,
      source: "DIRECT_PLAYBACK",
      policyVersion: 2,
      attributionMode: "PROMOTER",
    });

    await expect(recordStreamUsageLedgerEntry(directInput)).resolves.toEqual({
      duplicate: true,
      entryId: "usage-1",
      source: "DIRECT_PLAYBACK",
    });
    expect(mocks.entryCreate).not.toHaveBeenCalled();
    expect(mocks.alertUpsert).not.toHaveBeenCalled();
    expect(mocks.alertUpdateMany).not.toHaveBeenCalled();

    mocks.entryFindUnique.mockResolvedValueOnce({
      id: "usage-1",
      vendorId: "vendor-1",
      liveId: "live-1",
      sourcePageId: null,
      teamId: null,
      templateVersionId: null,
      promoterMembershipId: null,
      contentOwnerMembershipId: null,
      eventId: directInput.eventId,
      monthKey: "2026-07",
      watchSeconds: 30,
      source: "DIRECT_PLAYBACK",
      policyVersion: 2,
      attributionMode: "PROMOTER",
    });

    await expect(recordStreamUsageLedgerEntry(directInput)).rejects.toMatchObject({
      code: "event_conflict",
    });
  });

  it("fails closed when a source page is not currently attributable", async () => {
    mocks.resolveTeamFunnelAttribution.mockResolvedValueOnce(null);

    await expect(recordStreamUsageLedgerEntry({ ...directInput, sourcePageSlug: "missing-page" }))
      .rejects.toBeInstanceOf(StreamUsageValidationError);
    await expect(recordStreamUsageLedgerEntry({ ...directInput, sourcePageSlug: "missing-page" }))
      .rejects.toMatchObject({ code: "source_page_not_found" });
    expect(mocks.entryCreate).not.toHaveBeenCalled();
  });

  it("treats a concurrent unique insert with the same immutable payload as a duplicate", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2002" });
    mocks.entryFindUnique.mockResolvedValueOnce({
      id: "usage-concurrent",
      vendorId: "vendor-1",
      liveId: "live-1",
      sourcePageId: null,
      teamId: null,
      templateVersionId: null,
      promoterMembershipId: null,
      contentOwnerMembershipId: null,
      eventId: directInput.eventId,
      monthKey: "2026-07",
      watchSeconds: 45,
      source: "DIRECT_PLAYBACK",
      policyVersion: 2,
      attributionMode: "PROMOTER",
    });

    await expect(recordStreamUsageLedgerEntry(directInput)).resolves.toEqual({
      duplicate: true,
      entryId: "usage-concurrent",
      source: "DIRECT_PLAYBACK",
    });
  });

  it("fails closed when serializable quota admission detects a concurrent write", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2034" });

    await expect(recordStreamUsageLedgerEntry(directInput)).rejects.toMatchObject({
      code: "stream_minutes_exhausted",
    });
    expect(mocks.entryCreate).not.toHaveBeenCalled();
  });

  it("rejects a concurrent unique insert when the winning payload drifted", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2002" });
    mocks.entryFindUnique.mockResolvedValueOnce({
      id: "usage-concurrent",
      vendorId: "vendor-1",
      liveId: "live-1",
      sourcePageId: null,
      teamId: null,
      templateVersionId: null,
      promoterMembershipId: null,
      contentOwnerMembershipId: null,
      eventId: directInput.eventId,
      monthKey: "2026-07",
      watchSeconds: 30,
      source: "DIRECT_PLAYBACK",
      policyVersion: 2,
      attributionMode: "PROMOTER",
    });

    await expect(recordStreamUsageLedgerEntry(directInput)).rejects.toMatchObject({
      code: "event_conflict",
    });
  });
});
