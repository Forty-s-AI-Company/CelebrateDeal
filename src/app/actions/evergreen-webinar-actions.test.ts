import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorManagerContext: vi.fn(),
  liveFindFirst: vi.fn(),
  liveUpdateMany: vi.fn(),
  writeAuditLog: vi.fn(),
  auditSnapshot: vi.fn((value: unknown) => value),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
  parseZonedDateTimeLocal: vi.fn(),
  queueReconciliation: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.requireVendorManagerContext }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: mocks.auditSnapshot, writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ live: { findFirst: mocks.liveFindFirst, updateMany: mocks.liveUpdateMany }, $transaction: mocks.transaction }),
}));
vi.mock("@/lib/live-reminder-reconciliation", () => ({ queueLiveReminderReconciliationForCurrentLive: mocks.queueReconciliation }));
vi.mock("@/lib/zoned-date-time", () => ({ parseZonedDateTimeLocal: mocks.parseZonedDateTimeLocal }));

import { updateEvergreenWebinarSettingsAction } from "./evergreen-webinar-actions";

function form(overrides: Record<string, string> = {}) {
  const values = {
    _csrf: "csrf-token",
    liveId: "live-current",
    isEvergreen: "on",
    evergreenScheduleMode: "just_in_time",
    evergreenIntervalMinutes: "15",
    evergreenSessionStartAt: "2026-09-08T10:00",
    evergreenPitchAtSeconds: "90",
    evergreenConsultationAtSeconds: "120",
    evergreenPreviewEnabled: "on",
    evergreenPreviewRate: "1.5",
    ...overrides,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManagerContext.mockResolvedValue({
    auth: { user: { id: "user-current" }, member: { role: "owner" } },
    vendor: { id: "vendor-current", timezone: "Asia/Taipei" },
  });
  mocks.liveFindFirst.mockResolvedValue({
    id: "live-current",
    slug: "live-slug",
    streamMode: "vod",
    videoId: "video-current",
    video: { durationSec: 600 },
  });
  mocks.liveUpdateMany.mockResolvedValue({ count: 1 });
  mocks.queueReconciliation.mockResolvedValue({ status: "queued", jobId: "job-1" });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({ live: { updateMany: mocks.liveUpdateMany }, marker: "tx" }));
  mocks.writeAuditLog.mockResolvedValue(undefined);
  mocks.parseZonedDateTimeLocal.mockReturnValue(new Date("2026-09-08T02:00:00.000Z"));
});

describe("updateEvergreenWebinarSettingsAction", () => {
  it("checks CSRF, derives the tenant from the manager session, and audits a validated update", async () => {
    await expect(updateEvergreenWebinarSettingsAction(form())).rejects.toThrow("REDIRECT:/lives/live-current/edit?notice=evergreen_saved");

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledTimes(1);
    expect(mocks.liveFindFirst).toHaveBeenCalledWith({
      where: { id: "live-current", vendorId: "vendor-current" },
      select: {
        id: true,
        slug: true,
        streamMode: true,
        videoId: true,
        video: { select: { durationSec: true } },
      },
    });
    expect(mocks.liveUpdateMany).toHaveBeenCalledWith({
      where: { id: "live-current", vendorId: "vendor-current", streamMode: "vod", videoId: "video-current" },
      data: expect.objectContaining({
        isEvergreen: true,
        evergreenScheduleMode: "just_in_time",
        evergreenIntervalMinutes: 15,
        evergreenDailyTimes: [],
        evergreenSessionStartAt: new Date("2026-09-08T02:00:00.000Z"),
        evergreenPitchAtSeconds: 90,
        evergreenConsultationAtSeconds: 120,
        evergreenPreviewEnabled: true,
        evergreenPreviewRate: 1.5,
      }),
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: "vendor-current",
      actorId: "user-current",
      action: "evergreen_webinar_settings_updated",
      targetId: "live-current",
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/lives/live-current/edit");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/live/live-slug");
  });

  it("does not access a tenant resource when CSRF validation rejects the request", async () => {
    mocks.assertServerActionSecurity.mockRejectedValueOnce(new Error("Invalid CSRF token."));

    await expect(updateEvergreenWebinarSettingsAction(form())).rejects.toThrow("Invalid CSRF token.");

    expect(mocks.requireVendorManagerContext).not.toHaveBeenCalled();
    expect(mocks.liveFindFirst).not.toHaveBeenCalled();
    expect(mocks.liveUpdateMany).not.toHaveBeenCalled();
  });

  it("requires at least one daily time for a recurring daily Evergreen schedule", async () => {
    await expect(updateEvergreenWebinarSettingsAction(form({ evergreenScheduleMode: "recurring_daily" })))
      .rejects.toThrow("REDIRECT:/lives?error=invalid_evergreen_settings");

    expect(mocks.liveFindFirst).not.toHaveBeenCalled();
    expect(mocks.liveUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it.each([
    ["a real-time broadcast", { streamMode: "live" }, "evergreen_vod_required"],
    ["a video without a known duration", { video: { durationSec: null } }, "evergreen_duration_required"],
    ["a zero-length video", { video: { durationSec: 0 } }, "evergreen_duration_required"],
    ["a video longer than 24 hours", { video: { durationSec: 86_401 } }, "evergreen_duration_required"],
    ["a live without a source video", { videoId: null, video: null }, "evergreen_video_required"],
  ])("refuses to enable evergreen for %s", async (_label, overrides, error) => {
    mocks.liveFindFirst.mockResolvedValueOnce({
      id: "live-current", slug: "live-slug", streamMode: "vod", videoId: "video-current", video: { durationSec: 600 }, ...overrides,
    });

    await expect(updateEvergreenWebinarSettingsAction(form())).rejects.toThrow(`REDIRECT:/lives/live-current/edit?error=${error}`);

    expect(mocks.liveUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("still lets a merchant turn evergreen off for a real-time broadcast", async () => {
    mocks.liveFindFirst.mockResolvedValueOnce({ id: "live-current", slug: "live-slug", streamMode: "live", videoId: null, video: null });
    const data = form();
    data.delete("isEvergreen");

    await expect(updateEvergreenWebinarSettingsAction(data)).rejects.toThrow("REDIRECT:/lives/live-current/edit?notice=evergreen_saved");

    expect(mocks.liveUpdateMany).toHaveBeenCalledWith({
      where: { id: "live-current", vendorId: "vendor-current" },
      data: expect.objectContaining({ isEvergreen: false }),
    });
  });

  it("reports a concurrent playback change instead of enabling evergreen on it", async () => {
    mocks.liveUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(updateEvergreenWebinarSettingsAction(form())).rejects.toThrow("REDIRECT:/lives/live-current/edit?error=evergreen_live_changed");

    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it.each([["enabling", true], ["disabling", false]])("re-queues reminder reconciliation from the post-write state when %s evergreen", async (_label, enable) => {
    const data = form();
    if (!enable) data.delete("isEvergreen");

    await expect(updateEvergreenWebinarSettingsAction(data)).rejects.toThrow("REDIRECT:/lives/live-current/edit?notice=evergreen_saved");

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.queueReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({ marker: "tx" }),
      { vendorId: "vendor-current", liveId: "live-current" },
    );
    expect(mocks.liveUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.queueReconciliation.mock.invocationCallOrder[0]!);
  });

  it("does not queue reconciliation when the guarded write matched nothing", async () => {
    mocks.liveUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(updateEvergreenWebinarSettingsAction(form())).rejects.toThrow("REDIRECT:/lives/live-current/edit?error=evergreen_live_changed");
    expect(mocks.queueReconciliation).not.toHaveBeenCalled();
  });

  it("does not update or audit a live outside the current vendor", async () => {
    mocks.liveFindFirst.mockResolvedValueOnce(null);

    await expect(updateEvergreenWebinarSettingsAction(form({ liveId: "live-other-vendor" })))
      .rejects.toThrow("REDIRECT:/lives?error=live_not_found");

    expect(mocks.liveUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
