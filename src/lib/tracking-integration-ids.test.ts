import { describe, expect, it } from "vitest";
import { ga4InitScript, metaPixelInitScript, normalizeTrackingId, publicTrackingTags } from "./tracking-integration-ids";

describe("tracking integration IDs", () => {
  it.each([
    ["ga4", " g-abc123xyz9 ", "G-ABC123XYZ9"],
    ["gtm", "gtm-k9x2p7q", "GTM-K9X2P7Q"],
    ["metaPixel", " 123456789012345 ", "123456789012345"],
    ["tiktok", "c4a1b2c3d4e5f6g7h8i9", "C4A1B2C3D4E5F6G7H8I9"],
  ] as const)("accepts and normalizes a %s ID", (kind, raw, value) => {
    expect(normalizeTrackingId(kind, raw)).toEqual({ ok: true, value });
  });

  it("treats blank as cleared", () => {
    for (const kind of ["ga4", "gtm", "metaPixel", "tiktok"] as const) {
      expect(normalizeTrackingId(kind, "  ")).toEqual({ ok: true, value: null });
      expect(normalizeTrackingId(kind, null)).toEqual({ ok: true, value: null });
    }
  });

  it.each([
    ["ga4", "UA-12345-1"], ["ga4", "G-"], ["ga4", "G-ABC"], ["ga4", "G-ABC123');alert(1);//"], ["ga4", "GTM-ABCDEF"], ["ga4", "G-ＡＢＣ１２３"],
    ["gtm", "G-ABC1234"], ["gtm", "GTM-AB"], ["gtm", "GTM-ABC</script>"], ["gtm", "GTM-ABCDEF\nx"],
    ["metaPixel", "1234"], ["metaPixel", "12345abc"], ["metaPixel", "1".repeat(33)], ["metaPixel", "１２３４５６"], ["metaPixel", "123456\");alert(1)//"],
    ["tiktok", "<script>"], ["tiktok", "ABC"], ["tiktok", "ABCDEFGHIJ-123"],
  ] as const)("rejects %s %j", (kind, raw) => {
    expect(normalizeTrackingId(kind, raw)).toEqual({ ok: false });
  });

  it("rejects non-string form values", () => {
    expect(normalizeTrackingId("ga4", new Blob(["G-ABC123"]))).toEqual({ ok: false });
  });

  it("renders browser tags only when opted in, page views are on, and IDs are still valid; never GTM", () => {
    const base = { enableBrowserTags: true, enablePageView: true, ga4MeasurementId: "G-ABC1234", facebookPixelId: "123456789012345", googleTagManagerId: "GTM-ABCDEF" };
    expect(publicTrackingTags(base)).toEqual({ ga4MeasurementId: "G-ABC1234", metaPixelId: "123456789012345" });
    expect(publicTrackingTags({ ...base, enableBrowserTags: false })).toEqual({});
    expect(publicTrackingTags({ ...base, enablePageView: false })).toEqual({});
    expect(publicTrackingTags({ ...base, ga4MeasurementId: "G-x');evil()//", facebookPixelId: "abc" })).toEqual({});
    expect(publicTrackingTags(null)).toEqual({});
  });

  it("builds the standard snippets with the ID as a JSON string and refuses unvalidated IDs", () => {
    expect(ga4InitScript("G-ABC1234")).toContain('gtag("config","G-ABC1234")');
    expect(metaPixelInitScript("123456789012345")).toContain('fbq("init","123456789012345")');
    expect(metaPixelInitScript("123456789012345")).toContain("https://connect.facebook.net/en_US/fbevents.js");
    expect(() => ga4InitScript("G-ABC');x()//")).toThrow();
    expect(() => metaPixelInitScript("1\");x()//")).toThrow();
  });
});
