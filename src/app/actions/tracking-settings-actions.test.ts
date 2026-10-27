import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  security: vi.fn(),
  auth: vi.fn(),
  upsert: vi.fn(),
  findUnique: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.auth }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ trackingSetting: { upsert: mocks.upsert, findUnique: mocks.findUnique } }) }));

import { saveTrackingSettingsAction } from "@/app/actions/tracking-settings-actions";

function trackingFormData(facebookPixelId: string) {
  const formData = new FormData();
  formData.set("facebookPixelId", facebookPixelId);
  formData.set("enablePageView", "on");
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.security.mockResolvedValue(undefined);
  mocks.auth.mockResolvedValue({ id: "vendor-1" });
  mocks.upsert.mockResolvedValue({ id: "tracking-1" });
  mocks.findUnique.mockResolvedValue(null);
});

describe("saveTrackingSettingsAction", () => {
  it("rejects a Pixel ID the server transport would refuse, without writing settings", async () => {
    for (const pixelId of ["1234", "12345abc", "pixel-123456", "1".repeat(33), "123 456", "１２３４５６"]) {
      await expect(saveTrackingSettingsAction(trackingFormData(pixelId))).rejects.toThrow("redirect:/settings/tracking?tracking=invalid");
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("persists a numeric Pixel ID or a cleared value for the current vendor only", async () => {
    const formData = trackingFormData(" 1234567890 ");
    formData.set("vendorId", "foreign-vendor");
    await saveTrackingSettingsAction(formData);
    expect(mocks.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1" },
      create: expect.objectContaining({ vendorId: "vendor-1", facebookPixelId: "1234567890", enablePageView: true }),
      update: expect.objectContaining({ facebookPixelId: "1234567890", enablePageView: true }),
    }));
    await saveTrackingSettingsAction(trackingFormData(""));
    expect(mocks.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      create: expect.objectContaining({ facebookPixelId: null }),
      update: expect.objectContaining({ facebookPixelId: null }),
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/tracking");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("accepts only ID formats for GA4, GTM and TikTok, and stores the browser tag opt-in", async () => {
    for (const [key, value] of [["ga4MeasurementId", "UA-1234-1"], ["ga4MeasurementId", "<script>alert(1)</script>"], ["googleTagManagerId", "GTM-1');x()//"], ["tiktokPixelId", "pixel id"]] as const) {
      const formData = trackingFormData("1234567890");
      formData.set(key, value);
      await expect(saveTrackingSettingsAction(formData)).rejects.toThrow("redirect:/settings/tracking?tracking=invalid");
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
    const formData = trackingFormData("1234567890");
    formData.set("ga4MeasurementId", " g-abc1234 ");
    formData.set("googleTagManagerId", "gtm-abc123");
    formData.set("tiktokPixelId", "c4a1b2c3d4e5f6g7h8i9");
    formData.set("enableBrowserTags", "on");
    await saveTrackingSettingsAction(formData);
    expect(mocks.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1" },
      update: expect.objectContaining({ ga4MeasurementId: "G-ABC1234", googleTagManagerId: "GTM-ABC123", tiktokPixelId: "C4A1B2C3D4E5F6G7H8I9", enableBrowserTags: true }),
    }));
    await saveTrackingSettingsAction(trackingFormData("1234567890"));
    expect(mocks.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: expect.objectContaining({ ga4MeasurementId: null, enableBrowserTags: false }) }));
  });

  it("keeps an unchanged legacy value that predates the format check, but validates any change to it", async () => {
    mocks.findUnique.mockResolvedValue({ facebookPixelId: "1234567890", tiktokPixelId: "legacy tiktok id", googleTagManagerId: "UA-12345-1", ga4MeasurementId: null });
    const formData = trackingFormData("1234567890");
    formData.set("tiktokPixelId", " legacy tiktok id ");
    formData.set("googleTagManagerId", "UA-12345-1");
    formData.set("ga4MeasurementId", "G-ABC1234");
    await saveTrackingSettingsAction(formData);
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1" } }));
    expect(mocks.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      update: expect.objectContaining({ tiktokPixelId: "legacy tiktok id", googleTagManagerId: "UA-12345-1", ga4MeasurementId: "G-ABC1234" }),
    }));
    mocks.upsert.mockClear();
    formData.set("googleTagManagerId", "UA-99999-1");
    await expect(saveTrackingSettingsAction(formData)).rejects.toThrow("redirect:/settings/tracking?tracking=invalid");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects CSRF before tenant lookup or persistence", async () => {
    mocks.security.mockRejectedValue(new Error("CSRF denied"));
    await expect(saveTrackingSettingsAction(trackingFormData("1234567890"))).rejects.toThrow("CSRF denied");
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
