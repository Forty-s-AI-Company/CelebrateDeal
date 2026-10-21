export const VENDOR_FEATURE_MODULES = [
  "funnel_builder",
  "live_webinar",
  "affiliate_program",
  "tax_remuneration",
  "analytics_advanced",
  "consultation_booking",
] as const;

export type VendorFeatureModule = (typeof VENDOR_FEATURE_MODULES)[number];

export const ALL_VENDOR_FEATURE_MODULES: readonly VendorFeatureModule[] = VENDOR_FEATURE_MODULES;

/**
 * Modules that stay closed during the closed beta (D-02). Only a platform
 * administrator can open one for a vendor (`Vendor.betaFeatureGrants`);
 * merchants never write these grants themselves.
 */
export const BETA_GATED_FEATURES = [
  "courses",
  "billing",
  "funnel_binding",
  "consultation_booking",
  "browser_live",
  "danmaku",
] as const;

export type BetaGatedFeature = (typeof BETA_GATED_FEATURES)[number];

/** Every module a server-side gate or the client shell can check. */
export type GatedFeature = VendorFeatureModule | BetaGatedFeature;

export const BETA_FEATURE_LABELS: Record<BetaGatedFeature, string> = {
  courses: "課程與學員學習",
  billing: "平台方案、帳單、用量與月結",
  funnel_binding: "平台服務綁卡",
  consultation_booking: "諮詢預約",
  browser_live: "瀏覽器直播",
  danmaku: "彈幕與暖場控制台",
};

export const FEATURE_PRESETS = {
  live_course: ["funnel_builder", "live_webinar"],
  high_ticket_consulting: ["funnel_builder", "analytics_advanced", "consultation_booking"],
  flagship: [...VENDOR_FEATURE_MODULES],
} as const satisfies Record<string, readonly VendorFeatureModule[]>;

const moduleSet = new Set<string>(VENDOR_FEATURE_MODULES);
const betaSet = new Set<string>(BETA_GATED_FEATURES);

/** 舊商家或未寫入設定時採全開，避免部署後意外隱藏既有功能。 */
export function normalizeVendorFeatureModules(value: unknown): VendorFeatureModule[] {
  if (!Array.isArray(value)) return [...VENDOR_FEATURE_MODULES];
  return VENDOR_FEATURE_MODULES.filter((module) => value.includes(module));
}

export function parseVendorFeatureModules(value: unknown): VendorFeatureModule[] {
  if (!Array.isArray(value) || value.some((module) => typeof module !== "string" || !moduleSet.has(module))) {
    throw new Error("Invalid vendor feature modules.");
  }
  return VENDOR_FEATURE_MODULES.filter((module) => value.includes(module));
}

export function isBetaGatedFeature(feature: string): feature is BetaGatedFeature {
  return betaSet.has(feature);
}

/** Beta grants fail closed: a missing column or unknown value never opens a module. */
export function normalizeBetaFeatureGrants(value: unknown): BetaGatedFeature[] {
  if (!Array.isArray(value)) return [];
  return BETA_GATED_FEATURES.filter((feature) => value.includes(feature));
}

export function parseBetaFeatureGrants(value: unknown): BetaGatedFeature[] {
  if (!Array.isArray(value) || value.some((feature) => typeof feature !== "string" || !betaSet.has(feature))) {
    throw new Error("Invalid beta feature grants.");
  }
  return BETA_GATED_FEATURES.filter((feature) => value.includes(feature));
}

export type FeatureGateVendor = {
  enabledFeatureModules?: readonly string[] | null;
  betaFeatureGrants?: readonly string[] | null;
};

/**
 * The one predicate behind every server-side gate and the client shell.
 * A beta module needs a platform grant; a module that is also a merchant
 * toggle (consultation_booking) additionally needs the merchant to keep it on.
 */
export function isFeatureEnabled(vendor: FeatureGateVendor | null | undefined, feature: GatedFeature): boolean {
  if (!vendor) return false;
  if (isBetaGatedFeature(feature) && !normalizeBetaFeatureGrants(vendor.betaFeatureGrants).includes(feature)) return false;
  if (moduleSet.has(feature)) {
    return normalizeVendorFeatureModules(vendor.enabledFeatureModules).includes(feature as VendorFeatureModule);
  }
  return true;
}

/** Effective module list handed to the client shell for navigation and masks. */
export function enabledFeaturesForVendor(vendor: FeatureGateVendor | null | undefined): GatedFeature[] {
  const all: GatedFeature[] = [...VENDOR_FEATURE_MODULES, ...BETA_GATED_FEATURES.filter((feature) => !moduleSet.has(feature))];
  return all.filter((feature) => isFeatureEnabled(vendor, feature));
}

export function hasVendorFeature(modules: readonly GatedFeature[], feature: GatedFeature) {
  return modules.includes(feature);
}

const ROUTE_FEATURES: ReadonlyArray<{ prefixes: readonly string[]; feature: GatedFeature }> = [
  { prefixes: ["/forms", "/landing-pages", "/team-templates"], feature: "funnel_builder" },
  { prefixes: ["/billing/payouts", "/billing/course-payouts"], feature: "tax_remuneration" },
  { prefixes: ["/billing/plans", "/billing/invoices", "/billing/usage", "/billing/settlements"], feature: "billing" },
  { prefixes: ["/billing/payment-methods"], feature: "funnel_binding" },
  { prefixes: ["/lives", "/videos", "/interaction-scripts", "/interaction-roles"], feature: "live_webinar" },
  { prefixes: ["/affiliates", "/team-performance", "/settings/commissions"], feature: "affiliate_program" },
  { prefixes: ["/consultations"], feature: "consultation_booking" },
];

export function requiredFeatureForPath(pathname: string | null | undefined): GatedFeature | null {
  if (!pathname) return null;
  if (/^\/lives\/[^/]+\/analytics(?:\/|$)/u.test(pathname)) return "analytics_advanced";
  if (/^\/lives\/[^/]+\/presenter(?:\/|$)/u.test(pathname)) return "browser_live";
  if (/^\/products\/[^/]+\/(?:lessons|community)(?:\/|$)/u.test(pathname)) return "courses";
  return ROUTE_FEATURES.find(({ prefixes }) => prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)))?.feature ?? null;
}
