import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  ruleFindMany: vi.fn(),
  processJobs: vi.fn(),
  materialize: vi.fn(),
  captureOperationalError: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ liveNotificationRule: { findMany: mocks.ruleFindMany } }) }));
vi.mock("@/lib/live-notification-delivery", () => ({ materializeLiveNotificationRules: mocks.materialize }));
vi.mock("@/lib/live-reminder-reconciliation", () => ({ processLiveReminderReconciliationJobs: mocks.processJobs }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.captureOperationalError }));

import { rematerializeEvergreenLiveNow, scheduleEvergreenRematerialization } from "./evergreen-rematerialization";

const input = { vendorId: "vendor-a", liveId: "live-a", now: new Date("2026-10-30T00:00:00.000Z") };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.processJobs.mockResolvedValue([{ jobId: "job-1", status: "completed" }]);
  mocks.ruleFindMany.mockResolvedValue([{ id: "rule-1" }, { id: "rule-2" }]);
  mocks.materialize.mockResolvedValue([]);
});

describe("rematerializeEvergreenLiveNow", () => {
  it("works off this live's reminder job and re-materializes its active rules, both bound to the tenant", async () => {
    await expect(rematerializeEvergreenLiveNow(input)).resolves.toEqual({ reminderJobs: 1, notificationRules: 2, failed: [] });

    expect(mocks.processJobs).toHaveBeenCalledWith({ vendorId: "vendor-a", liveId: "live-a", now: input.now });
    expect(mocks.ruleFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-a", liveId: "live-a", isActive: true, trigger: { in: ["before_live", "during_live"] } },
      take: 50,
    }));
    expect(mocks.materialize).toHaveBeenCalledWith({ vendorId: "vendor-a", liveId: "live-a", ruleIds: ["rule-1", "rule-2"], now: input.now });
  });

  it("skips materialization when the live has no active before/during-live rules", async () => {
    mocks.ruleFindMany.mockResolvedValue([]);
    await expect(rematerializeEvergreenLiveNow(input)).resolves.toMatchObject({ notificationRules: 0, failed: [] });
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("contains a failing step, reports it and still runs the other step", async () => {
    mocks.processJobs.mockRejectedValue(new Error("db down"));

    await expect(rematerializeEvergreenLiveNow(input)).resolves.toEqual({ reminderJobs: 0, notificationRules: 2, failed: ["reminder_reconciliation"] });

    expect(mocks.materialize).toHaveBeenCalledTimes(1);
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(
      expect.any(Error),
      { source: "evergreen_rematerialization", operation: "reminder_reconciliation", status: "failed" },
    );
  });

  it("never throws when materialization and monitoring both fail", async () => {
    mocks.materialize.mockRejectedValue(new Error("boom"));
    mocks.captureOperationalError.mockImplementation(() => { throw new Error("monitoring down"); });

    await expect(rematerializeEvergreenLiveNow(input)).resolves.toMatchObject({ failed: ["notification_rules"] });
  });
});

describe("scheduleEvergreenRematerialization", () => {
  it("registers an after() hook that runs the tenant-bound re-materialization", async () => {
    expect(scheduleEvergreenRematerialization({ vendorId: "vendor-a", liveId: "live-a" })).toBe(true);
    expect(mocks.processJobs).not.toHaveBeenCalled();

    const hook = mocks.after.mock.calls[0]![0] as () => Promise<void>;
    await hook();

    expect(mocks.processJobs).toHaveBeenCalledWith(expect.objectContaining({ vendorId: "vendor-a", liveId: "live-a" }));
    expect(mocks.materialize).toHaveBeenCalledWith(expect.objectContaining({ vendorId: "vendor-a", liveId: "live-a" }));
  });

  it("falls back to the scheduled job outside a request scope", () => {
    mocks.after.mockImplementation(() => { throw new Error("after was called outside a request scope"); });
    expect(scheduleEvergreenRematerialization({ vendorId: "vendor-a", liveId: "live-a" })).toBe(false);
  });
});
