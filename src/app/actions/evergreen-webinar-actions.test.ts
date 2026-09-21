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
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.requireVendorManagerContext }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: mocks.auditSnapshot, writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ live: { findFirst: mocks.liveFindFirst, updateMany: mocks.liveUpdateMany } }),
}));
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
    videoId: "video-current",
    video: { durationSec: 600 },
  });
  mocks.liveUpdateMany.mockResolvedValue({ count: 1 });
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
        videoId: true,
        video: { select: { durationSec: true } },
      },
    });
    expect(mocks.liveUpdateMany).toHaveBeenCalledWith({
      where: { id: "live-current", vendorId: "vendor-current" },
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

  it("does not update or audit a live outside the current vendor", async () => {
    mocks.liveFindFirst.mockResolvedValueOnce(null);

    await expect(updateEvergreenWebinarSettingsAction(form({ liveId: "live-other-vendor" })))
      .rejects.toThrow("REDIRECT:/lives?error=live_not_found");

    expect(mocks.liveUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
