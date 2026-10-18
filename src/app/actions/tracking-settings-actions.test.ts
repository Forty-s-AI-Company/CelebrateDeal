import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  security: vi.fn(),
  auth: vi.fn(),
  upsert: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.auth }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ trackingSetting: { upsert: mocks.upsert } }) }));

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

  it("rejects CSRF before tenant lookup or persistence", async () => {
    mocks.security.mockRejectedValue(new Error("CSRF denied"));
    await expect(saveTrackingSettingsAction(trackingFormData("1234567890"))).rejects.toThrow("CSRF denied");
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
