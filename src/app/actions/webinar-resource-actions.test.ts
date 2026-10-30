import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    video: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    videoArchiveState: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    messageTemplate: { update: vi.fn(), create: vi.fn() },
    live: { findMany: vi.fn() },
  };
  return {
    assertServerActionSecurity: vi.fn(),
    requireVendorManagerContext: vi.fn(),
    writeAuditLog: vi.fn(),
    transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    tx,
    createSnapshot: vi.fn((input: Record<string, unknown>) => input),
    queueReconciliation: vi.fn(async () => ({ status: "queued" })),
    normalizeDraft: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("@/lib/auth", () => ({
  requireVendorManager: vi.fn(),
  requireVendorManagerContext: mocks.requireVendorManagerContext,
}));
vi.mock("@/lib/audit", () => ({
  auditSnapshot: (value: unknown) => value,
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ $transaction: mocks.transaction }),
}));
vi.mock("@/lib/image-assets", () => ({ resolveReadyImageAsset: vi.fn() }));
vi.mock("@/lib/live-video-readiness", () => ({ isLiveVideoReady: vi.fn() }));
vi.mock("@/lib/live-reminder-reconciliation", () => ({
  createLiveReminderReconciliationSnapshot: mocks.createSnapshot,
  queueLiveReminderReconciliation: mocks.queueReconciliation,
}));
vi.mock("@/lib/live-notification-delivery", () => ({
  supersedeLiveNotificationDeliveriesForTemplate: vi.fn(),
}));
vi.mock("@/lib/message-template", () => ({ normalizeMessageTemplateDraft: mocks.normalizeDraft }));
vi.mock("@/lib/registration-form-fields", () => ({ parseRegistrationFormFields: vi.fn() }));

import {
  archiveVideoAction,
  restoreVideoAction,
  upsertTemplateAction,
} from "@/app/actions/webinar-resource-actions";

const vendor = { id: "vendor-1" };
const auth = { user: { id: "user-1" }, member: { role: "owner" } };

function formData(id = "video-1") {
  const form = new FormData();
  form.set("id", id);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManagerContext.mockResolvedValue({ auth, vendor });
  mocks.tx.video.findFirst.mockResolvedValue({
    id: "video-1",
    status: "ready",
    sourceType: "cloudflare_stream",
    cloudflareReadyToStream: true,
    cloudflareLiveInputUid: null,
    liveInputStatus: null,
  });
  mocks.tx.video.update.mockResolvedValue({ id: "video-1" });
  mocks.tx.videoArchiveState.upsert.mockResolvedValue({ id: "archive-1" });
  mocks.tx.videoArchiveState.findUnique.mockResolvedValue({ previousStatus: "ready" });
});

describe("video archive/restore server actions", () => {
  it("archives only the current tenant video and preserves provider fields", async () => {
    await expect(archiveVideoAction(formData())).rejects.toThrow("redirect:/videos");

    expect(mocks.tx.video.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "video-1", vendorId: "vendor-1" },
    }));
    expect(mocks.tx.videoArchiveState.upsert).toHaveBeenCalledWith({
      where: { vendorId_videoId: { vendorId: "vendor-1", videoId: "video-1" } },
      create: { vendorId: "vendor-1", videoId: "video-1", previousStatus: "ready" },
      update: { previousStatus: "ready" },
    });
    expect(mocks.tx.video.update).toHaveBeenCalledWith({
      where: { id: "video-1", vendorId: "vendor-1" },
      data: { status: "archived" },
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: "vendor-1",
      action: "video_archived",
      targetId: "video-1",
    }));
  });

  it("restores the archived tenant video to its captured provider status", async () => {
    mocks.tx.video.findFirst.mockResolvedValue({
      id: "video-1",
      status: "archived",
      sourceType: "cloudflare_stream",
      cloudflareReadyToStream: true,
      cloudflareLiveInputUid: null,
      liveInputStatus: null,
    });

    await expect(restoreVideoAction(formData())).rejects.toThrow("redirect:/videos");

    expect(mocks.tx.videoArchiveState.findUnique).toHaveBeenCalledWith({
      where: { vendorId_videoId: { vendorId: "vendor-1", videoId: "video-1" } },
      select: { previousStatus: true },
    });
    expect(mocks.tx.video.update).toHaveBeenCalledWith({
      where: { id: "video-1", vendorId: "vendor-1" },
      data: { status: "ready" },
    });
  });

  it("does not mutate a cross-tenant video", async () => {
    mocks.tx.video.findFirst.mockResolvedValue(null);

    await expect(archiveVideoAction(formData("foreign-video"))).rejects.toThrow("redirect:/videos?error=not_found");

    expect(mocks.tx.video.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "foreign-video", vendorId: "vendor-1" },
    }));
    expect(mocks.tx.videoArchiveState.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.video.update).not.toHaveBeenCalled();
  });
});

describe("upsertTemplateAction reminder reconciliation", () => {
  it("passes each linked live's evergreen state into the reconciliation snapshot", async () => {
    const template = { id: "template-1", vendorId: "vendor-1", channel: "email", trigger: "live_reminder", subject: "提醒", body: "{{name}}", isActive: true };
    mocks.normalizeDraft.mockReturnValue({ success: true, data: { name: "提醒", channel: "email", trigger: "live_reminder", subject: "提醒", body: "{{name}}", isActive: true } });
    mocks.tx.messageTemplate.update.mockResolvedValue(template);
    const base = {
      slug: "live", title: "直播", status: "scheduled", scheduledAt: new Date("2030-01-01T00:00:00.000Z"), liveReminderOffsetMinutes: 60,
      streamMode: "vod", evergreenScheduleMode: "just_in_time", evergreenIntervalMinutes: 15, evergreenDailyTimes: [], evergreenSessionStartAt: null,
      video: { durationSec: 1_800 },
    };
    mocks.tx.live.findMany.mockResolvedValue([
      { ...base, id: "live-evergreen", isEvergreen: true },
      { ...base, id: "live-regular", isEvergreen: false },
    ]);
    const form = new FormData();
    form.set("id", "template-1");
    form.set("expectedUpdatedAt", "2026-10-29T00:00:00.000Z");

    await expect(upsertTemplateAction({ status: "idle", version: 0 } as never, form)).rejects.toThrow("redirect:/messages/templates?notice=reminders_reconciling");

    // B-3: READ COMMITTED so the supersede after the template update sees rows
    // committed by materializations the update waited for.
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "ReadCommitted" });
    expect(mocks.tx.live.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1", liveReminderTemplateId: "template-1" },
      select: expect.objectContaining({ isEvergreen: true, evergreenScheduleMode: true, video: { select: { durationSec: true } } }),
    }));
    expect(mocks.createSnapshot).toHaveBeenCalledWith(expect.objectContaining({ liveId: "live-evergreen", evergreenActive: true }));
    expect(mocks.createSnapshot).toHaveBeenCalledWith(expect.objectContaining({ liveId: "live-regular", evergreenActive: false }));
  });
});
