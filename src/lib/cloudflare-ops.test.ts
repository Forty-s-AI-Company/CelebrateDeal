import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { createDirectUploadMapping, createLiveInputMapping } from "@/lib/cloudflare-ops";
import { VendorEntitlementError } from "@/lib/entitlements";

const cloudflareMocks = vi.hoisted(() => ({
  createDirectCreatorUpload: vi.fn(async () => ({ uid: "stream-test-uid", uploadURL: "https://upload.example.test/direct" })),
  createLiveInput: vi.fn(async () => ({
    uid: "live-input-test-uid",
    rtmps: { url: "rtmps://live.example.test", streamKey: "secret-stream-key" },
    webRTC: { url: "https://webrtc.example.test" },
  })),
}));

vi.mock("@/lib/cloudflare-stream", () => cloudflareMocks);

const vendorIds: string[] = [];

async function createFixture(label: string, status = "active") {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const plan = await getDb().billingPlan.create({
    data: {
      name: `Entitlement ${label}`,
      code: `entitlement-${suffix}`,
      includedEvents: 5,
      includedAffiliates: 5,
      includedStorageMinutes: 300,
      includedCredits: 1000,
    },
  });
  const vendor = await getDb().vendor.create({
    data: {
      name: `Cloudflare ${label}`,
      slug: `cloudflare-${suffix}`,
      email: `cloudflare-${suffix}@example.test`,
      passwordHash: "test",
      subscriptions: { create: { planId: plan.id, status } },
      usageLimit: {
        create: {
          billingPlanId: plan.id,
          streamMinutesLimit: 600,
          storageMinutesLimit: 300,
          creditsLimit: 1000,
          resetAt: new Date(Date.now() + 86_400_000),
        },
      },
    },
  });
  vendorIds.push(vendor.id);
  return { vendor, plan };
}

afterEach(async () => {
  cloudflareMocks.createDirectCreatorUpload.mockClear();
  cloudflareMocks.createLiveInput.mockClear();
  const vendors = vendorIds.splice(0);
  const planIds = (await getDb().vendorSubscription.findMany({ where: { vendorId: { in: vendors } }, select: { planId: true } })).map((item) => item.planId);
  await getDb().vendor.deleteMany({ where: { id: { in: vendors } } });
  await getDb().billingPlan.deleteMany({ where: { id: { in: planIds } } });
});

describe("Cloudflare operations entitlement boundary", () => {
  it("rejects a suspended vendor before calling Cloudflare", async () => {
    const { vendor } = await createFixture("suspended", "suspended");
    await expect(createDirectUploadMapping({
      vendorId: vendor.id,
      title: "Denied upload",
      maxDurationSeconds: 600,
    })).rejects.toBeInstanceOf(VendorEntitlementError);
    expect(cloudflareMocks.createDirectCreatorUpload).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant video and live relations before calling Cloudflare", async () => {
    const current = await createFixture("current");
    const foreign = await createFixture("foreign");
    const [video, live] = await Promise.all([
      getDb().video.create({ data: { vendorId: foreign.vendor.id, title: "Foreign video", videoUrl: "https://example.test/video.mp4" } }),
      getDb().live.create({ data: { vendorId: foreign.vendor.id, title: "Foreign live", slug: `foreign-live-${Date.now()}`, scheduledAt: new Date() } }),
    ]);

    await expect(createDirectUploadMapping({
      vendorId: current.vendor.id,
      videoId: video.id,
      title: "Wrong tenant",
      maxDurationSeconds: 600,
    })).rejects.toThrow("not available");
    await expect(createLiveInputMapping({
      vendorId: current.vendor.id,
      liveId: live.id,
      name: "Wrong tenant live",
    })).rejects.toThrow("not available");
    expect(cloudflareMocks.createDirectCreatorUpload).not.toHaveBeenCalled();
    expect(cloudflareMocks.createLiveInput).not.toHaveBeenCalled();
  });

  it("creates an internal mapping only after entitlement checks pass", async () => {
    const { vendor } = await createFixture("allowed");
    const result = await createDirectUploadMapping({
      vendorId: vendor.id,
      title: "Allowed upload",
      maxDurationSeconds: 600,
    });

    expect(cloudflareMocks.createDirectCreatorUpload).toHaveBeenCalledOnce();
    expect(result.video).toMatchObject({
      vendorId: vendor.id,
      cloudflareStreamUid: "stream-test-uid",
      status: "processing",
    });
  });
});
