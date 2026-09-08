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

export const FEATURE_PRESETS = {
  live_course: ["funnel_builder", "live_webinar"],
  high_ticket_consulting: ["funnel_builder", "analytics_advanced", "consultation_booking"],
  flagship: [...VENDOR_FEATURE_MODULES],
} as const satisfies Record<string, readonly VendorFeatureModule[]>;

const moduleSet = new Set<string>(VENDOR_FEATURE_MODULES);

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

export function hasVendorFeature(modules: readonly VendorFeatureModule[], feature: VendorFeatureModule) {
  return modules.includes(feature);
}

const ROUTE_FEATURES: ReadonlyArray<{ prefixes: readonly string[]; feature: VendorFeatureModule }> = [
  { prefixes: ["/forms", "/team-templates"], feature: "funnel_builder" },
  { prefixes: ["/lives", "/videos", "/interaction-scripts", "/interaction-roles"], feature: "live_webinar" },
  { prefixes: ["/affiliates", "/team-performance", "/settings/commissions"], feature: "affiliate_program" },
  { prefixes: ["/billing/payouts", "/billing/course-payouts"], feature: "tax_remuneration" },
  { prefixes: ["/consultations"], feature: "consultation_booking" },
];

export function requiredFeatureForPath(pathname: string | null | undefined): VendorFeatureModule | null {
  if (!pathname) return null;
  if (/^\/lives\/[^/]+\/analytics(?:\/|$)/u.test(pathname)) return "analytics_advanced";
  return ROUTE_FEATURES.find(({ prefixes }) => prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)))?.feature ?? null;
}
