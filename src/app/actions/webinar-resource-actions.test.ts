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
  };
  return {
    assertServerActionSecurity: vi.fn(),
    requireVendorManagerContext: vi.fn(),
    writeAuditLog: vi.fn(),
    transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    tx,
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
  createLiveReminderReconciliationSnapshot: vi.fn(),
  queueLiveReminderReconciliation: vi.fn(),
}));
vi.mock("@/lib/live-notification-delivery", () => ({
  supersedeLiveNotificationDeliveriesForTemplate: vi.fn(),
}));
vi.mock("@/lib/message-template", () => ({ normalizeMessageTemplateDraft: vi.fn() }));
vi.mock("@/lib/registration-form-fields", () => ({ parseRegistrationFormFields: vi.fn() }));

import {
  archiveVideoAction,
  restoreVideoAction,
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
