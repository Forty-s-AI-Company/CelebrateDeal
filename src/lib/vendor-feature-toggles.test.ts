import { describe, expect, it } from "vitest";
import { ALL_VENDOR_FEATURE_MODULES, FEATURE_PRESETS, normalizeVendorFeatureModules, parseVendorFeatureModules, requiredFeatureForPath } from "./vendor-feature-toggles";

describe("vendor feature toggles", () => {
  it("defaults missing legacy settings to every module", () => {
    expect(normalizeVendorFeatureModules(undefined)).toEqual(ALL_VENDOR_FEATURE_MODULES);
  });

  it("normalizes order, duplicates, and unknown stored values safely", () => {
    expect(normalizeVendorFeatureModules(["live_webinar", "unknown", "live_webinar", "funnel_builder"])).toEqual(["funnel_builder", "live_webinar"]);
  });

  it("rejects untrusted update payloads instead of silently accepting unknown modules", () => {
    expect(() => parseVendorFeatureModules(["affiliate_program", "unknown"])).toThrow("Invalid vendor feature modules");
    expect(() => parseVendorFeatureModules("affiliate_program")).toThrow("Invalid vendor feature modules");
  });

  it("provides the three clean UI presets", () => {
    expect(FEATURE_PRESETS.live_course).toEqual(["funnel_builder", "live_webinar"]);
    expect(FEATURE_PRESETS.high_ticket_consulting).toEqual(["funnel_builder", "analytics_advanced", "consultation_booking"]);
    expect(FEATURE_PRESETS.flagship).toEqual(ALL_VENDOR_FEATURE_MODULES);
  });

  it("maps direct module URLs while keeping unrelated routes available", () => {
    expect(requiredFeatureForPath("/affiliates/commissions")).toBe("affiliate_program");
    expect(requiredFeatureForPath("/billing/payouts/batch-1")).toBe("tax_remuneration");
    expect(requiredFeatureForPath("/consultations")).toBe("consultation_booking");
    expect(requiredFeatureForPath("/settings/features")).toBeNull();
  });
});
