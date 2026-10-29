import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `after()` callbacks run inside the route's maximum duration. Every route,
 * page or layout whose request can register one (directly or through the
 * helpers below) must export the same literal limit as
 * IMMEDIATE_EMAIL_DISPATCH_MAX_DURATION_SECONDS, or a platform timeout can cut
 * an immediate email off mid-send.
 *
 * Segment config lives on the entry file only:
 * - `"use server"` modules (src/app/actions*) may only export async
 *   functions, so a Server Action takes the limit of the page that invokes it.
 * - Client components (the consultation booking block, the student portal
 *   login form) cannot export it either; the page that renders them does.
 *
 * The source is read as text instead of importing the modules, so the check
 * needs no database, provider or request scope.
 */

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, "src", "app");
const ENTRY_FILE = /^(route|page|layout)\.(ts|tsx)$/u;

/**
 * Imported names whose call can register `after()` during the request.
 * Each comment names the path to the hook, so a reviewer can keep the list in
 * step with the code.
 */
const AFTER_SCHEDULING_IMPORTS: Record<string, string> = {
  scheduleImmediateEmailDispatch: "registers after() itself",
  processPaymentWebhook: "paid receipt email",
  processDueWebhookRetries: "retryWebhookEvent -> processPaymentWebhook",
  retryWebhookEvent: "processPaymentWebhook",
  retryWebhookEventAction: "Server Action -> retryWebhookEvent",
  retryWp4HistoricalBuyerCallback: "retryWebhookEvent",
  retryQ1OriginalBuyerCallback: "retryWebhookEvent",
  retryQ1OriginalAfterSchemaRepair: "retryWebhookEvent",
  dispatchAutomationEvent: "automation emails",
  schedulePasswordResetLink: "password reset link",
  requestPasswordResetAction: "Server Action -> schedulePasswordResetLink",
  scheduleMerchantEmailVerification: "merchant email verification link",
  registerAction: "Server Action -> scheduleMerchantEmailVerification",
  createVendorMemberAction: "Server Action -> after() invitation delivery",
  requestMagicLinkAction: "Server Action -> magic link email",
  grantCustomerVoucherAction: "Server Action -> voucher email",
  updateConsultationBookingStatusAction: "Server Action -> dispatchAutomationEvent",
  createConsultationBookingAction: "Server Action -> dispatchAutomationEvent",
  // Client components that invoke one of the Server Actions above.
  StudentPortalLoginForm: "client form -> requestMagicLinkAction",
  ConsultationBookingBlock: "client block -> createConsultationBookingAction",
  PublicFunnelDocument: "renders ConsultationBookingBlock with a CSRF token",
};

/**
 * Entry files that must keep the limit. The detector has to find each one; if
 * a rename hides one from it, this list makes the test fail instead of
 * silently passing.
 */
const EXPECTED_ENTRIES = [
  "src/app/(app)/consultations/page.tsx",
  "src/app/(app)/customers/[id]/page.tsx",
  "src/app/(app)/settings/security/page.tsx",
  "src/app/admin/billing/dashboard/page.tsx",
  "src/app/admin/billing/webhooks/[id]/page.tsx",
  "src/app/admin/billing/webhooks/page.tsx",
  "src/app/api/admin/ops/payuni/q1-original-callback-retry/route.ts",
  "src/app/api/admin/ops/payuni/q1-original-schema-recovery/route.ts",
  "src/app/api/admin/ops/payuni/wp4-buyer-callback-retry/route.ts",
  "src/app/api/auth/password-reset/request/route.ts",
  "src/app/api/form-submissions/route.ts",
  "src/app/api/form-submissions/verify/route.ts",
  "src/app/api/jobs/webhook-retry/route.ts",
  "src/app/api/webhooks/payments/route.ts",
  "src/app/lp/[slug]/[stepPath]/page.tsx",
  "src/app/lp/[slug]/page.tsx",
  "src/app/password-reset/request/page.tsx",
  "src/app/portal/[vendorSlug]/login/page.tsx",
  "src/app/register/page.tsx",
];

function relative(file: string) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function entryFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entryFiles(full);
    return ENTRY_FILE.test(entry.name) ? [full] : [];
  });
}

/** Value-imported names with their module; `import type` is ignored. */
function importedNames(source: string) {
  const names: Array<{ name: string; from: string }> = [];
  const pattern = /^import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/gmu;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) continue;
    for (const raw of match[2].split(",")) {
      const specifier = raw.trim();
      if (!specifier || specifier.startsWith("type ")) continue;
      names.push({ name: specifier.split(/\s+as\s+/u)[0].trim(), from: match[3] });
    }
  }
  return names;
}

const SCHEDULING_NAMES = new Set(Object.keys(AFTER_SCHEDULING_IMPORTS));

function schedulesAfter(source: string) {
  return importedNames(source).some(({ name, from }) =>
    (name === "after" && from === "next/server") || SCHEDULING_NAMES.has(name));
}

function maxDurationExports(source: string) {
  return [...source.matchAll(/^export const maxDuration\s*=\s*([^;\n]+);/gmu)].map((match) => match[1].trim());
}

const files = entryFiles(APP_DIR).map((file) => ({ file: relative(file), source: fs.readFileSync(file, "utf8") }));
const scheduling = files.filter(({ source }) => schedulesAfter(source)).map(({ file }) => file).sort();

describe("maxDuration for requests that schedule after() work", () => {
  it("matches the shared immediate email dispatch limit", () => {
    const helper = fs.readFileSync(path.join(ROOT, "src/lib/email-delivery-immediate.ts"), "utf8");
    expect(helper).toMatch(/^export const IMMEDIATE_EMAIL_DISPATCH_MAX_DURATION_SECONDS = 60;$/mu);
  });

  it("detects every known entry that can schedule after() work", () => {
    expect(scheduling).toEqual(expect.arrayContaining(EXPECTED_ENTRIES));
  });

  it.each(scheduling)("%s exports maxDuration = 60", (file) => {
    const source = files.find((entry) => entry.file === file)!.source;
    expect(maxDurationExports(source)).toEqual(["60"]);
  });

  it("uses the same literal limit wherever maxDuration is exported", () => {
    const values = files.flatMap(({ file, source }) => maxDurationExports(source).map((value) => ({ file, value })));
    expect(values.length).toBeGreaterThanOrEqual(EXPECTED_ENTRIES.length);
    expect(values.filter(({ value }) => value !== "60")).toEqual([]);
  });

  it("keeps segment config out of Server Action modules", () => {
    const actionFiles = [path.join(APP_DIR, "actions.ts"), ...fs.readdirSync(path.join(APP_DIR, "actions"))
      .filter((name) => /\.ts$/u.test(name) && !/\.test\.ts$/u.test(name))
      .map((name) => path.join(APP_DIR, "actions", name))];
    const withConfig = actionFiles.filter((file) => maxDurationExports(fs.readFileSync(file, "utf8")).length > 0).map(relative);
    expect(withConfig).toEqual([]);
  });
});
