import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F-001 / F-002 module × entry matrix.
 *
 * Part 1 drives one real Server Action, route handler and server component per
 * closed-beta module with the module closed (must be blocked) and opened (must
 * reach the code behind the gate). Part 2 statically locks every other entry
 * point to its gate so a new or refactored entry cannot silently drop it.
 */

class DownstreamReached extends Error {
  constructor(readonly label: string) {
    super(`downstream:${label}`);
    downstream.reached.push(label);
  }
}

const downstream = vi.hoisted(() => ({ reached: [] as string[] }));
const state = vi.hoisted(() => ({
  vendor: { id: "vendor-1", enabledFeatureModules: [] as string[], betaFeatureGrants: [] as string[] },
  overrides: {} as Record<string, Record<string, (...args: unknown[]) => unknown>>,
}));

function deepProxy(label: string): unknown {
  return new Proxy(function stub() {}, {
    get(_target, property) {
      if (property === "then") return undefined;
      return deepProxy(`${label}.${String(property)}`);
    },
    apply() {
      throw new DownstreamReached(label);
    },
  });
}

vi.mock("@/lib/db", () => ({
  getDb: () => new Proxy({}, {
    get(_target, model: string) {
      if (model === "then") return undefined;
      if (model === "vendor") {
        return { findUnique: async () => ({ enabledFeatureModules: state.vendor.enabledFeatureModules, betaFeatureGrants: state.vendor.betaFeatureGrants }) };
      }
      const override = state.overrides[model];
      if (override) return new Proxy(override, { get: (target, method: string) => target[method] ?? deepProxy(`${model}.${method}`) });
      return deepProxy(model);
    },
  }),
}));

function vendorContext() {
  return {
    auth: { user: { id: "user-1", mfaFactor: null }, member: { id: "member-1", role: "owner", status: "active" }, vendor: state.vendor },
    vendor: state.vendor,
    user: { id: "user-1" },
    session: { id: "session-1" },
    member: { id: "member-1", role: "owner", status: "active" },
  };
}

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth")>(),
  getCurrentAuth: async () => vendorContext().auth,
  requireVendorContext: async () => vendorContext(),
  requireVendorManagerContext: async () => vendorContext(),
  requireVendorManager: async () => state.vendor,
  requireVendorFinance: async () => vendorContext(),
  requireVendorOwnerFinance: async () => vendorContext(),
}));
vi.mock("@/lib/csrf", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/csrf")>(),
  assertServerActionSecurity: async () => undefined,
  assertServerActionOrigin: async () => undefined,
  getCsrfToken: async () => "csrf",
  verifyCsrfToken: async () => true,
}));
vi.mock("@/lib/recent-mfa", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/recent-mfa")>(),
  requireRecentMfa: () => { throw new DownstreamReached("requireRecentMfa"); },
  recentMfaStatus: () => "verified",
}));
vi.mock("@/lib/sales-project-scope", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sales-project-scope")>(),
  getSalesProjectScope: async () => { throw new DownstreamReached("getSalesProjectScope"); },
  requireEditableSalesProjectScope: async () => { throw new DownstreamReached("requireEditableSalesProjectScope"); },
}));
vi.mock("@/lib/student-portal-auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/student-portal-auth")>(),
  requireStudentPortalSession: async () => ({ session: { vendorId: state.vendor.id, customerKeyHash: "hash" }, vendor: { id: state.vendor.id } }),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/rate-limit")>(),
  checkRateLimit: async () => null,
}));
vi.mock("@/lib/api-security", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api-security")>(),
  requireSameOriginRequest: () => null,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "https://app.example.test", host: "app.example.test" }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const ALL_GRANTS = ["courses", "billing", "funnel_binding", "consultation_booking", "browser_live", "danmaku"];

function closeModule(feature: string) {
  state.vendor.enabledFeatureModules = ["funnel_builder", "live_webinar", "affiliate_program", "tax_remuneration", "analytics_advanced", "consultation_booking"];
  state.vendor.betaFeatureGrants = ALL_GRANTS.filter((grant) => grant !== feature);
}

function openModule() {
  state.vendor.enabledFeatureModules = ["funnel_builder", "live_webinar", "affiliate_program", "tax_remuneration", "analytics_advanced", "consultation_booking"];
  state.vendor.betaFeatureGrants = [...ALL_GRANTS];
}

async function settle(run: () => unknown): Promise<{ value?: unknown; error?: unknown }> {
  try {
    return { value: await run() };
  } catch (error) {
    return { error };
  }
}

function isNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_HTTP_ERROR_FALLBACK;404");
}

async function isFeatureDisabledResponse(value: unknown) {
  if (!(value instanceof Response) || value.status !== 404) return false;
  const body = await value.clone().json().catch(() => null) as { code?: string } | null;
  return body?.code === "FEATURE_DISABLED";
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function jsonRequest(url: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: { origin: "https://app.example.test", host: "app.example.test", "x-celebratedeal-client": "1", "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

type Entry = { feature: string; kind: "action" | "route" | "page"; name: string; run: () => Promise<unknown> };

const ENTRIES: Entry[] = [
  // consultation_booking
  { feature: "consultation_booking", kind: "action", name: "saveMobileConsultationAction", run: async () => (await import("@/app/actions/mobile-consultation-actions")).saveMobileConsultationAction(form({ bookingId: "booking-1" })) },
  { feature: "consultation_booking", kind: "action", name: "createConsultationEventAction", run: async () => (await import("@/app/actions/consultation-actions")).createConsultationEventAction(form({ title: "x" })) },
  { feature: "consultation_booking", kind: "route", name: "GET /portal/[vendorSlug]/calendar/[bookingId]", run: async () => (await import("@/app/portal/[vendorSlug]/calendar/[bookingId]/route")).GET(new Request("https://app.example.test/portal/shop/calendar/b1"), { params: Promise.resolve({ vendorSlug: "shop", bookingId: "b1" }) }) },
  { feature: "consultation_booking", kind: "page", name: "/consultations/mobile", run: async () => (await import("@/app/(app)/consultations/mobile/page")).default() },
  // courses
  { feature: "courses", kind: "action", name: "saveCourseLessonAction", run: async () => (await import("@/app/actions/course-curriculum-actions")).saveCourseLessonAction(form({ productId: "product-1", revision: "1", chapterTitle: "第一章", title: "第一單元", videoUrl: "https://media.example.test/course.mp4", durationSeconds: "100" })) },
  { feature: "courses", kind: "route", name: "GET /portal/[vendorSlug]/learn/[courseId]/progress", run: async () => (await import("@/app/portal/[vendorSlug]/learn/[courseId]/progress/route")).GET(jsonRequest("https://app.example.test/portal/shop/learn/c1/progress"), { params: Promise.resolve({ vendorSlug: "shop", courseId: "c1" }) }) },
  { feature: "courses", kind: "page", name: "/products/[id]/lessons", run: async () => (await import("@/app/(app)/products/[id]/lessons/page")).default({ params: Promise.resolve({ id: "product-1" }), searchParams: Promise.resolve({}) }) },
  // billing
  { feature: "billing", kind: "action", name: "payInvoiceAction", run: async () => (await import("@/app/actions/invoice-actions")).payInvoiceAction(form({ invoiceId: "invoice-1" })) },
  { feature: "billing", kind: "route", name: "GET /billing/invoices/export", run: async () => (await import("@/app/(app)/billing/invoices/export/route")).GET() },
  { feature: "billing", kind: "page", name: "/billing/invoices", run: async () => (await import("@/app/(app)/billing/invoices/page")).default() },
  // funnel_binding (no merchant-facing route handler: the PayUni callback is
  // provider-signed and bound to a setup intent the gated action creates)
  { feature: "funnel_binding", kind: "action", name: "revokePaymentMethodReferenceAction", run: async () => (await import("@/app/actions/payment-method-actions")).revokePaymentMethodReferenceAction(form({ referenceId: "ref-1" })) },
  { feature: "funnel_binding", kind: "page", name: "/billing/payment-methods", run: async () => (await import("@/app/(app)/billing/payment-methods/page")).default({ searchParams: Promise.resolve({}) } as never) },
  // browser_live (no Server Action exists for this module)
  { feature: "browser_live", kind: "route", name: "GET /api/live-presenter", run: async () => (await import("@/app/api/live-presenter/route")).GET(jsonRequest("https://app.example.test/api/live-presenter?liveId=live-1")) },
  { feature: "browser_live", kind: "page", name: "/lives/[id]/presenter", run: async () => (await import("@/app/(app)/lives/[id]/presenter/page")).default({ params: Promise.resolve({ id: "live-1" }) }) },
  // danmaku (no Server Action exists; the page-level gate is the studio prop, covered in live-interaction-studio.test.tsx)
  { feature: "danmaku", kind: "route", name: "GET /api/live-danmaku/scripted", run: async () => (await import("@/app/api/live-danmaku/scripted/route")).GET(jsonRequest("https://app.example.test/api/live-danmaku/scripted?liveId=live-1")) },
  { feature: "danmaku", kind: "route", name: "GET /api/live-danmaku (viewer)", run: async () => (await import("@/app/api/live-danmaku/route")).GET(jsonRequest("https://app.example.test/api/live-danmaku?vendorId=vendor-1&liveId=live-1", { headers: { cookie: "celebratedeal_live_viewer=" + "a".repeat(43) } })) },
];

beforeEach(() => {
  downstream.reached.length = 0;
  state.overrides = {};
});

describe("closed-beta module × entry matrix (F-001 / F-002)", () => {
  it("covers action, route and page for every module where that entry kind exists", () => {
    const kinds = (feature: string) => new Set(ENTRIES.filter((entry) => entry.feature === feature).map((entry) => entry.kind));
    for (const feature of ["consultation_booking", "courses", "billing"]) expect([...kinds(feature)].sort()).toEqual(["action", "page", "route"]);
    expect([...kinds("funnel_binding")].sort()).toEqual(["action", "page"]);
    expect([...kinds("browser_live")].sort()).toEqual(["page", "route"]);
    expect([...kinds("danmaku")]).toEqual(["route"]);
  });

  it.each(ENTRIES)("$feature $kind $name is blocked while the module is closed", async (entry) => {
    closeModule(entry.feature);
    const outcome = await settle(entry.run);
    if (entry.kind === "action") {
      expect(outcome.error).toMatchObject({ name: "FeatureDisabledError", code: "FEATURE_DISABLED", feature: entry.feature, message: "此功能目前尚未開放。" });
    } else if (entry.kind === "page") {
      expect(isNotFound(outcome.error)).toBe(true);
    } else {
      expect(outcome.error).toBeUndefined();
      expect(await isFeatureDisabledResponse(outcome.value)).toBe(true);
    }
    // Nothing behind the gate ran.
    expect(downstream.reached).toEqual([]);
  });

  it.each(ENTRIES)("$feature $kind $name proceeds past the gate once the module is opened", async (entry) => {
    openModule();
    const outcome = await settle(entry.run);
    expect((outcome.error as { name?: string } | undefined)?.name).not.toBe("FeatureDisabledError");
    expect(isNotFound(outcome.error) && downstream.reached.length === 0).toBe(false);
    expect(await isFeatureDisabledResponse(outcome.value)).toBe(false);
    expect(downstream.reached.length).toBeGreaterThan(0);
  });

  it("blocks the anonymous consultation booking action for a vendor without the grant", async () => {
    closeModule("consultation_booking");
    state.overrides.consultationEvent = { findFirst: async () => ({ vendorId: "vendor-1" }) };
    const { createConsultationBookingAction } = await import("@/app/actions/consultation-actions");
    const result = await createConsultationBookingAction(form({
      eventId: "event-1", startTime: "2026-11-01T02:00:00.000Z", clientName: "合成", clientEmail: "buyer@example.test", answers: "{}",
    }));
    expect(result).toEqual({ status: "unavailable" });
    expect(downstream.reached).toEqual([]);
  });

  it("consultation_booking also honours the merchant's own toggle", async () => {
    openModule();
    state.vendor.enabledFeatureModules = ["funnel_builder"];
    const outcome = await settle(async () => (await import("@/app/actions/mobile-consultation-actions")).saveMobileConsultationAction(form({})));
    expect(outcome.error).toMatchObject({ code: "FEATURE_DISABLED" });
  });
});

const ROOT = path.resolve(__dirname, "../..");
const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** Every server entry of a closed-beta module and the gate it must call. */
const STATIC_MATRIX: Array<{ feature: string; file: string; gate: RegExp; count?: number }> = [
  // consultation_booking
  { feature: "consultation_booking", file: "src/app/(app)/consultations/page.tsx", gate: /requireFeatureOrNotFound\(vendor, "consultation_booking"\)/u },
  { feature: "consultation_booking", file: "src/app/(app)/consultations/mobile/page.tsx", gate: /requireFeatureOrNotFound\(vendor, "consultation_booking"\)/u },
  { feature: "consultation_booking", file: "src/app/actions/consultation-actions.ts", gate: /requireFeature\(vendor, "consultation_booking"\)|isVendorFeatureEnabled\(getDb\(\), [a-zA-Z.]+, "consultation_booking"\)/gu, count: 3 },
  { feature: "consultation_booking", file: "src/app/actions/mobile-consultation-actions.ts", gate: /requireFeature\(vendor, "consultation_booking"\)/u },
  { feature: "consultation_booking", file: "src/app/portal/[vendorSlug]/calendar/[bookingId]/route.ts", gate: /isVendorFeatureEnabled\(getDb\(\), session\.vendorId, "consultation_booking"\)/u },
  { feature: "consultation_booking", file: "src/lib/landing-page-service.ts", gate: /isVendorFeatureEnabled\(getDb\(\), scope\.vendorId, "consultation_booking"\)/u },
  // courses
  { feature: "courses", file: "src/app/(app)/products/[id]/lessons/page.tsx", gate: /requireFeatureOrNotFound\(vendor, "courses"\)/u },
  { feature: "courses", file: "src/app/(app)/products/[id]/community/page.tsx", gate: /requireFeatureOrNotFound\(vendor, "courses"\)/u },
  { feature: "courses", file: "src/app/actions/course-curriculum-actions.ts", gate: /requireFeature\(vendor, "courses"\)/u },
  { feature: "courses", file: "src/app/actions/course-community-actions.ts", gate: /requireFeature\(vendor, "courses"\)/u },
  { feature: "courses", file: "src/app/actions/product-actions.ts", gate: /isVendorFeatureEnabled\(db, vendorId, "courses"\)/u },
  { feature: "courses", file: "src/app/portal/[vendorSlug]/learn/[courseId]/page.tsx", gate: /requireVendorFeatureOrNotFound\(getDb\(\), session\.vendorId, "courses"\)/u },
  { feature: "courses", file: "src/app/portal/[vendorSlug]/learn/[courseId]/community/page.tsx", gate: /requireVendorFeatureOrNotFound\(getDb\(\), session\.vendorId, "courses"\)/u },
  { feature: "courses", file: "src/app/portal/[vendorSlug]/learn/[courseId]/community/[postId]/page.tsx", gate: /requireVendorFeatureOrNotFound\(getDb\(\), session\.vendorId, "courses"\)/u },
  ...[
    ["certificate/route.ts", 1], ["community/data/route.ts", 2], ["notifications/enroll/route.ts", 1], ["notifications/reminders/route.ts", 2],
    ["notifications/route.ts", 2], ["notifications/verify/route.ts", 1], ["progress/route.ts", 2],
  ].map(([file, count]) => ({ feature: "courses", file: `src/app/portal/[vendorSlug]/learn/[courseId]/${file}`, gate: /isVendorFeatureEnabled\(getDb\(\), session\.vendorId, "courses"\)\) return featureDisabledResponse\(\)/gu, count: count as number })),
  // billing
  ...["plans/page.tsx", "invoices/page.tsx", "invoices/[invoiceId]/page.tsx", "usage/page.tsx", "settlements/page.tsx"].map((file) => ({ feature: "billing", file: `src/app/(app)/billing/${file}`, gate: /requireFeatureOrNotFound\((?:finance\.)?vendor, "billing"\)/u })),
  { feature: "billing", file: "src/app/(app)/billing/invoices/export/route.ts", gate: /featureGateResponse\(vendor, "billing"\)/u },
  { feature: "billing", file: "src/app/actions/invoice-actions.ts", gate: /requireFeature\(vendor, "billing"\)/u },
  { feature: "billing", file: "src/lib/platform-plan-checkout.ts", gate: /requireFeature\(vendor, "billing"\)/u },
  { feature: "billing", file: "src/app/api/billing/plans/select/route.ts", gate: /error instanceof FeatureDisabledError\) return featureDisabledResponse\(\)/u },
  // funnel_binding
  { feature: "funnel_binding", file: "src/app/(app)/billing/payment-methods/page.tsx", gate: /requireFeatureOrNotFound\(vendor, "funnel_binding"\)/u },
  { feature: "funnel_binding", file: "src/app/actions/payment-method-actions.ts", gate: /requireFeature\(vendor, "funnel_binding"\)/gu, count: 2 },
  // browser_live
  { feature: "browser_live", file: "src/app/(app)/lives/[id]/presenter/page.tsx", gate: /requireFeatureOrNotFound\(vendor, "browser_live"\)/u },
  { feature: "browser_live", file: "src/app/api/live-presenter/route.ts", gate: /featureGateResponse\(auth\.vendor, "browser_live"\)/u },
  { feature: "browser_live", file: "src/app/api/live-media/route.ts", gate: /isVendorFeatureEnabled\(db, vendorId, "browser_live"\)/u },
  // danmaku
  { feature: "danmaku", file: "src/app/api/live-danmaku/route.ts", gate: /featureGateResponse\(auth\.vendor, "danmaku"\)|isVendorFeatureEnabled\(getDb\(\), vendorId, "danmaku"\)/gu, count: 2 },
  { feature: "danmaku", file: "src/app/api/live-danmaku/scripted/route.ts", gate: /featureGateResponse\(auth\.vendor, "danmaku"\)/u },
  { feature: "danmaku", file: "src/app/(app)/lives/[id]/edit/page.tsx", gate: /danmakuEnabled=\{isFeatureEnabled\(vendor, "danmaku"\)\}/u },
];

describe("static gate inventory (F-001 / F-002)", () => {
  it.each(STATIC_MATRIX)("$file gates $feature", ({ file, gate, count }) => {
    const matches = source(file).match(gate.global ? gate : new RegExp(gate.source, `${gate.flags}g`)) ?? [];
    expect(matches.length).toBe(count ?? 1);
  });

  it("routes every card-binding requirement through the funnel_binding gate", () => {
    for (const file of ["src/lib/live-quota-admission.ts", "src/lib/team-funnel-live-sharing.ts", "src/app/actions.ts", "src/lib/landing-page-service.ts", "src/app/(app)/dashboard/dashboard-details.tsx"]) {
      expect(source(file)).toMatch(/isCardBindingRequiredForVendor\(/u);
    }
    for (const file of ["src/app/actions/sales-workspace-actions.ts", "src/app/(app)/layout.tsx", "src/app/(app)/onboarding/page.tsx"]) {
      expect(source(file)).toMatch(/isCardBindingRequired\(vendor\)/u);
    }
  });
});
