import { describe, expect, it } from "vitest";
import {
  ALL_VENDOR_FEATURE_MODULES,
  BETA_GATED_FEATURES,
  FEATURE_PRESETS,
  enabledFeaturesForVendor,
  isFeatureEnabled,
  normalizeBetaFeatureGrants,
  normalizeVendorFeatureModules,
  parseBetaFeatureGrants,
  parseVendorFeatureModules,
  requiredFeatureForPath,
} from "./vendor-feature-toggles";

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
    // A merchant cannot grant itself a closed-beta module through its own settings.
    expect(() => parseVendorFeatureModules(["billing"])).toThrow("Invalid vendor feature modules");
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

  it("maps closed-beta module URLs", () => {
    expect(requiredFeatureForPath("/billing/plans")).toBe("billing");
    expect(requiredFeatureForPath("/billing/invoices/inv-1")).toBe("billing");
    expect(requiredFeatureForPath("/billing/usage")).toBe("billing");
    expect(requiredFeatureForPath("/billing/settlements")).toBe("billing");
    expect(requiredFeatureForPath("/billing/payment-methods")).toBe("funnel_binding");
    expect(requiredFeatureForPath("/billing/electronic-invoices")).toBeNull();
    expect(requiredFeatureForPath("/lives/live-1/presenter")).toBe("browser_live");
    expect(requiredFeatureForPath("/lives/live-1/edit")).toBe("live_webinar");
    expect(requiredFeatureForPath("/products/p-1/lessons")).toBe("courses");
    expect(requiredFeatureForPath("/products/p-1/community")).toBe("courses");
    expect(requiredFeatureForPath("/products/p-1")).toBeNull();
  });
});

describe("closed-beta grants (F-001 / F-002)", () => {
  it("fails closed for missing, malformed or unknown grants", () => {
    expect(normalizeBetaFeatureGrants(undefined)).toEqual([]);
    expect(normalizeBetaFeatureGrants("billing")).toEqual([]);
    expect(normalizeBetaFeatureGrants(["danmaku", "unknown", "billing", "billing"])).toEqual(["billing", "danmaku"]);
  });

  it("parses admin input strictly", () => {
    expect(parseBetaFeatureGrants(["danmaku", "courses"])).toEqual(["courses", "danmaku"]);
    expect(() => parseBetaFeatureGrants(["courses", "funnel_builder"])).toThrow("Invalid beta feature grants");
    expect(() => parseBetaFeatureGrants(null)).toThrow("Invalid beta feature grants");
  });

  it("keeps every closed-beta module off for a vendor without grants, including legacy all-open vendors", () => {
    for (const feature of BETA_GATED_FEATURES) {
      expect(isFeatureEnabled({ enabledFeatureModules: undefined, betaFeatureGrants: [] }, feature)).toBe(false);
      expect(isFeatureEnabled({ enabledFeatureModules: [...ALL_VENDOR_FEATURE_MODULES] }, feature)).toBe(false);
    }
    expect(isFeatureEnabled(null, "funnel_builder")).toBe(false);
  });

  it("opens a module only for the vendor that holds the grant", () => {
    expect(isFeatureEnabled({ betaFeatureGrants: ["billing"] }, "billing")).toBe(true);
    expect(isFeatureEnabled({ betaFeatureGrants: ["billing"] }, "courses")).toBe(false);
  });

  it("requires both the platform grant and the merchant toggle for consultation booking", () => {
    expect(isFeatureEnabled({ enabledFeatureModules: ["consultation_booking"], betaFeatureGrants: [] }, "consultation_booking")).toBe(false);
    expect(isFeatureEnabled({ enabledFeatureModules: [], betaFeatureGrants: ["consultation_booking"] }, "consultation_booking")).toBe(false);
    expect(isFeatureEnabled({ enabledFeatureModules: ["consultation_booking"], betaFeatureGrants: ["consultation_booking"] }, "consultation_booking")).toBe(true);
  });

  it("hands the shell the effective module list", () => {
    expect(enabledFeaturesForVendor({ enabledFeatureModules: ["funnel_builder", "consultation_booking"], betaFeatureGrants: ["danmaku"] })).toEqual(["funnel_builder", "danmaku"]);
    expect(enabledFeaturesForVendor({ enabledFeatureModules: ["consultation_booking"], betaFeatureGrants: ["consultation_booking", "courses"] })).toEqual(["consultation_booking", "courses"]);
  });
});
