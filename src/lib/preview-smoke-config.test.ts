import { afterEach, describe, expect, it, vi } from "vitest";
import { withPreviewSmokeVendorId } from "./preview-smoke-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("withPreviewSmokeVendorId", () => {
  it("uses the server-owned fixture only in Preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("SMOKE_VENDOR_ID", "vendor-preview");

    expect(withPreviewSmokeVendorId({ title: "Smoke" })).toEqual({
      title: "Smoke",
      vendorId: "vendor-preview",
    });
  });

  it("never injects the fixture in production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SMOKE_VENDOR_ID", "vendor-preview");

    expect(withPreviewSmokeVendorId({ title: "Smoke" })).toEqual({ title: "Smoke" });
  });

  it("preserves an explicit vendor id", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("SMOKE_VENDOR_ID", "vendor-preview");

    expect(withPreviewSmokeVendorId({ vendorId: "vendor-explicit" })).toEqual({ vendorId: "vendor-explicit" });
  });
});
