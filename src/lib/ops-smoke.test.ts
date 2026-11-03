import { afterEach, describe, expect, it, vi } from "vitest";
import { bindOpsSmokeVendor, opsSmokeVendorId } from "./ops-smoke";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("bindOpsSmokeVendor (F-016)", () => {
  it("binds an omitted vendorId to the server-configured smoke vendor in any environment", () => {
    for (const environment of ["preview", "production"]) {
      vi.stubEnv("VERCEL_ENV", environment);
      vi.stubEnv("SMOKE_VENDOR_ID", "vendor-smoke");
      expect(bindOpsSmokeVendor({ title: "Smoke" })).toEqual({ ok: true, payload: { title: "Smoke", vendorId: "vendor-smoke" } });
    }
  });

  it("accepts a caller that repeats the configured vendor", () => {
    vi.stubEnv("SMOKE_VENDOR_ID", "vendor-smoke");
    expect(bindOpsSmokeVendor({ vendorId: "vendor-smoke" })).toEqual({ ok: true, payload: { vendorId: "vendor-smoke" } });
  });

  it.each([["another tenant", "vendor-other"], ["an empty id", ""], ["a non-string id", 7], ["null", null]])(
    "refuses %s with 403",
    async (_label, vendorId) => {
      vi.stubEnv("SMOKE_VENDOR_ID", "vendor-smoke");
      const result = bindOpsSmokeVendor({ vendorId, title: "Smoke" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(403);
      await expect(result.response.json()).resolves.toEqual({ error: "Vendor is not permitted for smoke operations" });
    },
  );

  it.each([undefined, "", "   ", "vendor with spaces", "x".repeat(129)])(
    "returns 503 when SMOKE_VENDOR_ID is %j, even for an explicit vendorId",
    async (configured) => {
      vi.stubEnv("SMOKE_VENDOR_ID", configured);
      expect(opsSmokeVendorId()).toBeNull();
      const result = bindOpsSmokeVendor({ vendorId: "vendor-any" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(503);
    },
  );

  it("leaves non-object payloads for schema validation", () => {
    vi.stubEnv("SMOKE_VENDOR_ID", "vendor-smoke");
    expect(bindOpsSmokeVendor(["vendor-other"])).toEqual({ ok: true, payload: ["vendor-other"] });
    expect(bindOpsSmokeVendor(null)).toEqual({ ok: true, payload: null });
  });
});
