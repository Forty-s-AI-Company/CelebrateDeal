import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IMMEDIATE_EMAIL_DISPATCH_MAX_DURATION_SECONDS } from "@/lib/email-delivery-immediate";

/**
 * `after()` callbacks run inside the route's maximum duration. Every route,
 * page or layout whose request can register one (directly or through the
 * helpers below) must export a literal limit of at least
 * IMMEDIATE_EMAIL_DISPATCH_MAX_DURATION_SECONDS, or a platform timeout can cut
 * an immediate email off mid-send. Batch routes may need more: the
 * webhook-retry job keeps the 300 s Fluid Compute default (the Hobby maximum)
 * so a lower limit cannot cut its batch off mid-run.
 *
 * Segment config lives on the entry file only:
 * - `"use server"` modules (src/app/actions*) may only export async
 *   functions, so a Server Action takes the limit of the page that invokes it.
 * - Client components (the consultation booking block, the student portal
 *   login form) cannot export it either; the page that renders them does.
 *
 * Entry files are read as text instead of being imported, so the check needs
 * no database, provider or request scope.
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
  dispatchPaymentPaidAutomation: "dispatchAutomationEvent",
  dispatchPaymentPaidAutomationByOrder: "dispatchPaymentPaidAutomation",
  dispatchFormNoShowAutomationsForLive: "dispatchAutomationEvent",
  schedulePasswordResetLink: "password reset link",
  requestPasswordResetAction: "Server Action -> schedulePasswordResetLink",
  scheduleMerchantEmailVerification: "merchant email verification link",
  registerAction: "Server Action -> scheduleMerchantEmailVerification",
  createVendorMemberAction: "Server Action -> after() invitation delivery",
  scheduleAccountEmailChangeRequest: "login email change verification and notice mail",
  requestAccountEmailChangeAction: "Server Action -> scheduleAccountEmailChangeRequest",
  requestMagicLinkAction: "Server Action -> magic link email",
  grantCustomerVoucherAction: "Server Action -> voucher email",
  updateConsultationBookingStatusAction: "Server Action -> dispatchAutomationEvent",
  createConsultationBookingAction: "Server Action -> dispatchAutomationEvent",
  scheduleEvergreenRematerialization: "registers after() itself",
  updateEvergreenWebinarSettingsAction: "Server Action -> scheduleEvergreenRematerialization",
  // Components whose form posts to one of the Server Actions above.
  EvergreenWebinarSettings: "form -> updateEvergreenWebinarSettingsAction",
  AccountEmailChangeCard: "form -> requestAccountEmailChangeAction",
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
  "src/app/(app)/lives/[id]/edit/page.tsx",
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

/** Platform ceiling for maxDuration on Hobby with Fluid Compute. */
const FLUID_HOBBY_MAX_DURATION_SECONDS = 300;

/** Entries whose exact limit is pinned: batches that need more than the email dispatch limit, and bounded retry queues. */
const BATCH_ENTRY_MAX_DURATIONS: Record<string, number> = {
  "src/app/api/jobs/webhook-retry/route.ts": 300,
  // B-2: not an after() entry; its limit bounds the inventory reservation's
  // Serializable retry queue (12 attempts, about 6.6 s of backoff) plus the
  // provider call, instead of the 300 s platform default.
  "src/app/api/payments/checkout/route.ts": 60,
};

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

/**
 * Named value imports and re-exports with their module, including
 * `import X, { … } from` and `export { … } from`. `import type` and
 * `export type` are ignored because they cannot call anything.
 */
function importedNames(source: string) {
  const names: Array<{ name: string; from: string }> = [];
  const pattern = /^(?:import|export)\s+(type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/gmu;
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
  it("keeps the shared immediate email dispatch limit at 60 seconds", () => {
    expect(IMMEDIATE_EMAIL_DISPATCH_MAX_DURATION_SECONDS).toBe(60);
  });

  it("parses default-plus-named imports and named re-exports", () => {
    expect(importedNames([
      'import Thing, { processPaymentWebhook as run } from "@/lib/payment-webhooks";',
      'export { registerAction } from "@/app/actions/registration-actions";',
      'import type { WebhookEvent } from "@prisma/client";',
      'export type { Other } from "./other";',
    ].join("\n"))).toEqual([
      { name: "processPaymentWebhook", from: "@/lib/payment-webhooks" },
      { name: "registerAction", from: "@/app/actions/registration-actions" },
    ]);
  });

  it("detects every known entry that can schedule after() work", () => {
    expect(scheduling).toEqual(expect.arrayContaining(EXPECTED_ENTRIES));
  });

  it.each(scheduling)("%s exports a maxDuration that covers immediate dispatch", (file) => {
    const source = files.find((entry) => entry.file === file)!.source;
    const values = maxDurationExports(source);
    expect(values).toHaveLength(1);
    expect(Number(values[0])).toBeGreaterThanOrEqual(IMMEDIATE_EMAIL_DISPATCH_MAX_DURATION_SECONDS);
  });

  it("keeps every exported maxDuration a literal between the dispatch limit and the platform ceiling", () => {
    const values = files.flatMap(({ file, source }) => maxDurationExports(source).map((value) => ({ file, value })));
    expect(values.length).toBeGreaterThanOrEqual(EXPECTED_ENTRIES.length);
    expect(values.filter(({ value }) => !/^\d+$/u.test(value)
      || Number(value) < IMMEDIATE_EMAIL_DISPATCH_MAX_DURATION_SECONDS
      || Number(value) > FLUID_HOBBY_MAX_DURATION_SECONDS)).toEqual([]);
  });

  it.each(Object.entries(BATCH_ENTRY_MAX_DURATIONS))("%s keeps maxDuration = %i", (file, expected) => {
    const source = files.find((entry) => entry.file === file)!.source;
    expect(maxDurationExports(source)).toEqual([String(expected)]);
  });

  it("keeps segment config out of Server Action modules", () => {
    const actionFiles = [path.join(APP_DIR, "actions.ts"), ...fs.readdirSync(path.join(APP_DIR, "actions"))
      .filter((name) => /\.ts$/u.test(name) && !/\.test\.ts$/u.test(name))
      .map((name) => path.join(APP_DIR, "actions", name))];
    const withConfig = actionFiles.filter((file) => maxDurationExports(fs.readFileSync(file, "utf8")).length > 0).map(relative);
    expect(withConfig).toEqual([]);
  });
});
