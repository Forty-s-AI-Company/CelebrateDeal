import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTwoTenantFixture,
  formData,
  type TenantActor,
  type TenantData,
  type TwoTenantFixture,
} from "@/test/two-tenant-fixture";
import { withAllFeatures } from "@/test/two-tenant-fixture-extras";
import { addTenantContent, audienceFunnelContent, type TenantContent } from "@/test/two-tenant-fixture-content";

// A2-06 (R-05 / F-134 third batch): the second-tenant matrix for the content and
// settings Server Actions that until now had only static or mock-level checks
// (docs/codex-goal/TENANT_ACTION_MATRIX.md). As in the money and PII batch,
// only the session, CSRF, MFA step-up, rate-limit, navigation and outbound
// provider boundaries are synthetic. Each "foreign" row hands tenant B's
// identifiers to a tenant-A actor: it must be refused the same way a missing
// record is, nothing of tenant B may be echoed back, and neither tenant's rows
// may change. Each "own" row is the same action with tenant A's identifiers and
// must go through, so a refusal above is the tenant boundary and not a broken
// form.
const runtime = vi.hoisted(() => ({
  actor: null as unknown,
  cookies: [] as Array<{ name: string; value: string }>,
}));
const mocks = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  scheduleImmediateEmailDispatch: vi.fn(),
  dispatchLiveStarted: vi.fn(),
  scheduleEvergreenRematerialization: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    getAll: () => runtime.cookies,
    get: (name: string) => runtime.cookies.find((cookie) => cookie.name === name),
  })),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`redirect:${url}`);
  },
  notFound: (): never => {
    throw new Error("not_found");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("@/lib/csrf", () => ({
  assertServerActionSecurity: vi.fn(async () => undefined),
  assertServerActionOrigin: vi.fn(async () => undefined),
}));
vi.mock("@/lib/recent-mfa", () => ({ requireRecentMfa: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => null),
  getRateLimitProviderStatus: () => ({ durable: true, configured: true }),
}));
vi.mock("@/lib/app-url", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-url")>()),
  getCanonicalAppUrl: () => "http://localhost:3000",
}));
// Only a free plan is selected below: the provider is never asked for a checkout.
vi.mock("@/lib/payment-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payment-providers")>()),
  getPaymentProvider: () => ({ id: "demo", createCheckoutSession: mocks.createCheckoutSession }),
}));
vi.mock("@/lib/email-delivery-immediate", () => ({ scheduleImmediateEmailDispatch: mocks.scheduleImmediateEmailDispatch }));
vi.mock("@/lib/line-live-started", () => ({ dispatchLiveStartedLineNotificationsSafely: mocks.dispatchLiveStarted }));
vi.mock("@/lib/evergreen-rematerialization", () => ({ scheduleEvergreenRematerialization: mocks.scheduleEvergreenRematerialization }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth")>();
  const current = () => runtime.actor as TenantActor;
  const session = { id: "synthetic-session" };
  const auth = () => ({ user: current().user, member: current().member, vendor: current().vendor, session });
  const memberContext = async () => ({ auth: auth(), user: current().user, vendor: current().vendor, member: current().member });
  const finance = async () => ({ user: current().user, session, vendor: current().vendor, member: current().member });
  return {
    ...original,
    getCurrentAuth: async () => ({ ...auth(), isPlatformAdmin: false, isMfaVerified: true }),
    requireAuth: async () => ({ ...auth(), isPlatformAdmin: false }),
    requireVendor: async () => current().vendor,
    requireVendorManager: async () => current().vendor,
    requireVendorManagerContext: async () => ({ auth: auth(), vendor: current().vendor }),
    requireVendorManagerMember: memberContext,
    requireVendorSupportMember: memberContext,
    requireVendorFinance: finance,
    requireVendorOwnerFinance: finance,
  };
});

import { upsertLiveAction } from "@/app/actions";
import { selectBillingPlanAction } from "@/app/(app)/billing/plans/actions";
import { defaultFunnelOperations } from "@/lib/funnel-operations";
import { initialInteractionRoleActionState } from "@/lib/interaction-role-action-state";
import { liveStudioDraftFromFormData } from "@/lib/live-studio-draft-client";
import { LIVE_STUDIO_LAST_STEP_INDEX } from "@/lib/live-studio-steps";
import { initialMessageTemplateActionState } from "@/lib/message-template";
import { createAutomationRecipeAction, createAutomationRuleAction, dryRunAutomationRuleAction } from "./automation-actions";
import { saveBrandSettingsAction, saveBrandSettingsActionState } from "./brand-settings-actions";
import { toggleConsultationEventAction, updateConsultationEventAction } from "./consultation-actions";
import { updateEvergreenWebinarSettingsAction } from "./evergreen-webinar-actions";
import { upsertFormBuilderAction } from "./form-actions";
import { readFunnelOperations, updateFunnelOperations } from "./funnel-operations-actions";
import {
  deleteInteractionRoleAction,
  deleteInteractionScriptAction,
  duplicateInteractionScriptAction,
  endLiveInteractionAction,
  getLivePollStudioSnapshotAction,
  saveInteractionScript,
  unbindInteractionScriptFromLiveAction,
  upsertInteractionRoleAction,
  upsertInteractionRoleActionState,
  upsertInteractionScriptAction,
} from "./interaction-actions";
import { landingPageAction } from "./landing-page-actions";
import { publishSalesProjectAction, selectSalesProjectAction } from "./sales-workspace-actions";
import {
  archiveVideoAction,
  restoreVideoAction,
  upsertFormAction,
  upsertTemplateAction,
  upsertVideoAction,
} from "./webinar-resource-actions";

const db = new PrismaClient();
let fixture: TwoTenantFixture;
let content: { a: TenantContent; b: TenantContent };

type Tenant = TenantData & { c: TenantContent };
type Fix = { a: Tenant; b: Tenant };

/** Every row the actions below could write, per tenant, as comparable JSON. */
async function snapshot(vendorId: string) {
  const byVendor = { where: { vendorId }, orderBy: { id: "asc" as const } };
  return JSON.stringify([
    await db.vendor.findUnique({ where: { id: vendorId } }),
    await db.salesProject.findMany(byVendor),
    await db.salesProjectProduct.findMany({ where: { vendorId }, orderBy: { productId: "asc" } }),
    await db.userOnboardingPreference.findMany(byVendor),
    await db.registrationForm.findMany(byVendor),
    await db.video.findMany(byVendor),
    await db.videoArchiveState.findMany(byVendor),
    await db.imageAsset.findMany(byVendor),
    await db.messageTemplate.findMany(byVendor),
    await db.interactionRole.findMany(byVendor),
    await db.interactionScript.findMany(byVendor),
    await db.interactionEvent.findMany({ where: { script: { vendorId } }, orderBy: { id: "asc" } }),
    await db.live.findMany(byVendor),
    await db.liveProduct.findMany(byVendor),
    await db.liveStudioDraft.findMany(byVendor),
    await db.liveInteractionRun.findMany(byVendor),
    await db.landingPage.findMany(byVendor),
    await db.landingPageVersion.findMany(byVendor),
    await db.automationRule.findMany(byVendor),
    await db.consultationEvent.findMany(byVendor),
    await db.vendorSubscription.findMany(byVendor),
    await db.vendorUsageLimit.findMany(byVendor),
    await db.paymentTransaction.findMany(byVendor),
    await db.auditLog.count({ where: { vendorId } }),
  ]);
}

/**
 * A Server Action ends in `redirect()` (thrown), returns a state object, or
 * throws. Everything becomes one comparable string.
 */
async function outcome(run: () => Promise<unknown>) {
  try {
    const value = await run();
    if (value && typeof value === "object" && "status" in value && "message" in value) {
      const state = value as { status: string; message: string };
      return `state:${state.status}:${state.message}`;
    }
    if (value && typeof value === "object" && "ok" in value && "message" in value) {
      const result = value as { ok: boolean; message: string };
      return `ok:${result.ok}:${result.message}`;
    }
    if (value && typeof value === "object" && "error" in value) return `state-error:${String((value as { error: unknown }).error)}`;
    return `value:${JSON.stringify(value) ?? "undefined"}`;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("redirect:")) return error.message;
    if (error instanceof Error && error.message === "not_found") return "not_found";
    if (error instanceof Prisma.PrismaClientKnownRequestError) return `prisma:${error.code}`;
    if (error instanceof Error) return `error:${error.message}`;
    throw error;
  }
}

type Row = {
  name: string;
  actor?: (f: Fix) => TenantActor;
  /** Rows the request needs that exist before the snapshot (for example a Live Studio draft). */
  arrange?: (f: Fix) => Promise<FormData>;
  run: (f: Fix, arranged: FormData) => Promise<unknown>;
  /** Substring the redirect URL, state message or error must contain. */
  expected: string;
  /** Own-tenant rows only: extra assertions on tenant A. */
  verify?: (f: Fix) => Promise<void>;
};

const owner = (f: Fix) => f.a.actors.owner;
const idle = { status: "idle" as const, message: "" };
// The Funnel editor state has no idle value; the previous state is not read.
const pageIdle = { status: "error" as const, message: "" };
const noArrangement = new FormData();

function lines(form: FormData, entries: Record<string, string[]>) {
  for (const [key, values] of Object.entries(entries)) for (const value of values) form.append(key, value);
  return form;
}

/** A Live Studio draft of tenant A (optionally bound to `liveId`) and the form that claims it. */
async function liveDraft(f: Fix, fields: Record<string, string>, liveId?: string) {
  const data = formData({
    title: "合成直播",
    slug: `two-tenant-live-${randomUUID()}`,
    scheduledAt: "2099-11-29T20:00",
    streamMode: "vod",
    affiliateMode: "disabled",
    maxConcurrentViewers: "500",
    stopWhenCreditsBelow: "300",
    usageAttributionMode: "PROMOTER",
    quotaPayerScope: "VENDOR",
    splitOwnerBps: "3000",
    splitPromoterBps: "7000",
    status: "draft",
    ...fields,
  });
  if (liveId) data.set("id", liveId);
  const saved = await db.liveStudioDraft.create({
    data: {
      vendorId: f.a.vendor.id,
      liveId: liveId ?? null,
      updatedByMemberId: f.a.actors.owner.member.id,
      payload: liveStudioDraftFromFormData(data, LIVE_STUDIO_LAST_STEP_INDEX),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  data.set("liveDraftId", saved.id);
  data.set("liveDraftRevision", String(saved.revision));
  return data;
}

const videoForm = (id: string, extra: Record<string, string> = {}) => formData({
  id, title: "改名影片", videoUrl: "https://video.example.test/edited.m3u8", durationSec: "120", estimatedMinutes: "2", ...extra,
});
const formFields = JSON.stringify([{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }]);
const resourceForm = (id: string) => formData({ id, name: "改名表單", slug: `edited-${randomUUID()}`, headline: "Register", fields: formFields, isActive: "on" });
const builderForm = (fields: Record<string, string>) => formData({
  name: "合成表單", slug: `builder-${randomUUID()}`, headline: "Register", description: "Synthetic", submitLabel: "Submit", successMessage: "Saved", isActive: "on", fields: formFields, ...fields,
});
const templateForm = (id: string, expectedUpdatedAt: string) => formData({
  id, expectedUpdatedAt, name: "改名範本", channel: "email", trigger: "registration_confirmed", subject: "{{live_title}} 報名成功", body: "{{name}} 已報名 {{unsubscribe_url}}", isActive: "on",
});
const roleForm = (fields: Record<string, string>) => formData({ name: "改名角色", roleType: "official", isActive: "true", isScheduled: "true", ...fields });
const customAvatar = (assetId: string) => ({ avatarMode: "custom", avatarUploadPhase: "success", avatarAssetId: assetId });
function scriptForm(fields: Record<string, string>, event: { eventType: string; roleId?: string; productId?: string; message?: string }) {
  return lines(formData({ name: "合成腳本", status: "draft", ...fields }), {
    eventType: [event.eventType],
    triggerSec: ["30"],
    eventTitle: [""],
    message: [event.message ?? ""],
    roleId: [event.roleId ?? ""],
    productId: [event.productId ?? ""],
    ctaLabel: [""],
    ctaUrl: [""],
  });
}
const chatEvent = (roleId: string) => ({ eventType: "chat_message", roleId, message: "合成訊息" });
const evergreenForm = (liveId: string) => formData({ liveId, evergreenScheduleMode: "just_in_time", evergreenIntervalMinutes: "15", evergreenPreviewRate: "1" });
const consultationForm = (eventId: string) => formData({
  eventId, title: "改名諮詢", durationMinutes: "60", bufferMinutes: "0", timezone: "Asia/Taipei", weeklySchedule: JSON.stringify([{ day: 1, ranges: ["09:00-12:00"] }]), intakeFormFields: "[]",
});
const ruleForm = (productId: string) => formData({
  name: "合成回購規則", trigger: "payment_paid", conditionValue: "100", actionVoucher: "on", productId, discountType: "percentage", discountValue: "10", expiresInDays: "30", voucherLineNotificationShown: "1",
});
const funnelContent = () => JSON.stringify(audienceFunnelContent());
const pageOperation = (operation: string, id: string, fields: Record<string, string> = {}) => formData({ operation, id, revision: "1", ...fields });
const brandForm = (fields: Record<string, string>) => formData({ name: "改名商店", slug: `brand-${randomUUID()}`, timezone: "Asia/Taipei", primaryColor: "#2563eb", ctaColor: "#f97316", ...fields });
const funnelSettings = (pageId: string) => formData({
  settings: JSON.stringify({ pageId, revision: 1, name: "改名網站", slug: `funnel-${randomUUID()}`, currency: "TWD", operations: defaultFunnelOperations() }),
});

const PAGE_NOT_FOUND = "state:error:找不到這個一頁式網站，或你沒有管理它的權限。";
const PAGE_INPUT_INVALID = "state:error:請確認頁面內容與已選的報名表單、直播都屬於目前專案且可公開使用。";

const foreignRows: Row[] = [
  // Live Studio (upsertLiveAction, src/app/actions.ts).
  {
    // A3-02: the database no longer accepts A's draft bound to B's live
    // (composite foreign key, src/lib/live-studio-draft-live-vendor-fk-migration.db.test.ts),
    // so A's own draft carries B's live id in the form instead.
    name: "live: save a draft that edits tenant B's Live (A's draft, B's live id in the form)",
    arrange: async (f) => {
      const form = await liveDraft(f, { videoId: f.a.c.videoId });
      form.set("id", f.b.liveId);
      return form;
    },
    run: (_f, form) => upsertLiveAction(form),
    expected: "error=invalid_reference",
  },
  {
    name: "live: bind tenant B's ready video",
    arrange: (f) => liveDraft(f, { videoId: f.b.c.videoId }),
    run: (_f, form) => upsertLiveAction(form),
    expected: "error=invalid_reference",
  },
  {
    name: "live: bind tenant B's registration form",
    arrange: (f) => liveDraft(f, { formId: f.b.c.liveFormId }),
    run: (_f, form) => upsertLiveAction(form),
    expected: "error=invalid_reference",
  },
  {
    name: "live: bind tenant B's confirmation email template",
    arrange: (f) => liveDraft(f, { messageTemplateId: f.b.c.messageTemplateId }),
    run: (_f, form) => upsertLiveAction(form),
    expected: "error=invalid_reference",
  },
  {
    name: "live: bind tenant B's interaction script",
    arrange: (f) => liveDraft(f, { interactionScriptId: f.b.c.scriptId }),
    run: (_f, form) => upsertLiveAction(form),
    expected: "error=invalid_reference",
  },
  {
    name: "live: use tenant B's image asset as the hero image",
    arrange: (f) => liveDraft(f, { heroImageAssetId: f.b.c.imageAssetId }),
    run: (_f, form) => upsertLiveAction(form),
    expected: "error=invalid_reference",
  },
  // Live interactions (interaction-actions.ts).
  {
    name: "live poll: end tenant B's open poll",
    run: (f) => endLiveInteractionAction(idle, formData({ runId: f.b.c.pollRunId })),
    expected: "state:error:投票不存在或已經結束。",
  },
  {
    name: "live poll: read tenant B's poll results",
    run: (f) => getLivePollStudioSnapshotAction(f.b.liveId),
    expected: "value:[]",
  },
  // Interaction roles.
  {
    name: "interaction role: rename tenant B's role",
    run: (f) => upsertInteractionRoleAction(roleForm({ id: f.b.c.roleId })),
    expected: "redirect:/interaction-roles/new?error=missing_role",
  },
  {
    name: "interaction role: create a role with tenant B's avatar image asset",
    run: (f) => upsertInteractionRoleAction(roleForm(customAvatar(f.b.c.imageAssetId))),
    expected: "redirect:/interaction-roles/new?error=invalid_role",
  },
  {
    name: "interaction role (state form): rename tenant B's role",
    run: (f) => upsertInteractionRoleActionState(initialInteractionRoleActionState, roleForm({ id: f.b.c.roleId })),
    expected: "state:error:這個角色已不存在或不屬於目前商店。",
  },
  {
    name: "interaction role (state form): use tenant B's avatar image asset",
    run: (f) => upsertInteractionRoleActionState(initialInteractionRoleActionState, roleForm(customAvatar(f.b.c.imageAssetId))),
    expected: "state:error:角色頭像圖片資產無效，請重新上傳。",
  },
  {
    name: "interaction role: delete tenant B's role",
    run: (f) => deleteInteractionRoleAction(formData({ id: f.b.c.roleId })),
    expected: "redirect:/interaction-roles/new?error=missing_role",
  },
  // Interaction scripts.
  {
    name: "interaction script: overwrite tenant B's script and events",
    run: (f) => upsertInteractionScriptAction(scriptForm({ id: f.b.c.scriptId }, chatEvent(f.a.c.roleId))),
    expected: "redirect:/interaction-scripts?error=missing_script",
  },
  {
    name: "interaction script: schedule tenant B's role in a new script",
    run: (f) => upsertInteractionScriptAction(scriptForm({}, chatEvent(f.b.c.roleId))),
    expected: "redirect:/interaction-scripts/new?error=invalid_reference",
  },
  {
    name: "interaction script: spotlight tenant B's product in a new script",
    run: (f) => upsertInteractionScriptAction(scriptForm({}, { eventType: "product_spotlight", productId: f.b.productId })),
    expected: "redirect:/interaction-scripts/new?error=invalid_reference",
  },
  {
    name: "interaction script (native form transport): overwrite tenant B's script",
    run: (f) => saveInteractionScript(scriptForm({ id: f.b.c.scriptId }, chatEvent(f.a.c.roleId))),
    expected: "redirect:/interaction-scripts?error=missing_script",
  },
  {
    name: "interaction script: unbind tenant B's script from tenant B's Live",
    run: (f) => unbindInteractionScriptFromLiveAction(formData({ id: f.b.c.scriptId, liveId: f.b.liveId })),
    expected: "error:直播不存在或未綁定此互動腳本。",
  },
  {
    name: "interaction script: unbind tenant B's script id from tenant A's Live",
    run: (f) => unbindInteractionScriptFromLiveAction(formData({ id: f.b.c.scriptId, liveId: f.a.liveId })),
    expected: "error:直播不存在或未綁定此互動腳本。",
  },
  {
    name: "interaction script: duplicate tenant B's script into tenant A",
    run: (f) => duplicateInteractionScriptAction(formData({ id: f.b.c.scriptId })),
    // A3-02: an explicit error, the same as for a missing source; the snapshots prove no copy was made.
    expected: "redirect:/interaction-scripts?error=missing_script",
  },
  {
    name: "interaction script: delete tenant B's script",
    run: (f) => deleteInteractionScriptAction(formData({ id: f.b.c.scriptId })),
    expected: "redirect:/interaction-scripts?error=missing_script",
  },
  // Videos, registration forms and message templates (webinar-resource-actions.ts, form-actions.ts).
  {
    name: "video: edit tenant B's video",
    run: (f) => upsertVideoAction(videoForm(f.b.c.videoId)),
    expected: "redirect:/videos?error=not_found",
  },
  {
    name: "video: use tenant B's image asset as tenant A's thumbnail",
    run: (f) => upsertVideoAction(videoForm(f.a.c.videoId, { thumbnailAssetId: f.b.c.imageAssetId })),
    expected: "?error=invalid_image_asset",
  },
  {
    name: "video: archive tenant B's video",
    run: (f) => archiveVideoAction(formData({ id: f.b.c.videoId })),
    expected: "redirect:/videos?error=not_found",
  },
  {
    name: "video: restore tenant B's archived video",
    run: (f) => restoreVideoAction(formData({ id: f.b.c.archivedVideoId })),
    expected: "redirect:/videos?error=not_found",
  },
  {
    name: "registration form (legacy editor): overwrite tenant B's form",
    run: (f) => upsertFormAction(resourceForm(f.b.formId)),
    expected: "prisma:P2025",
  },
  {
    name: "registration form (builder): overwrite tenant B's form with B's own version stamp",
    run: (f) => upsertFormBuilderAction(idle, builderForm({ id: f.b.formId, expectedUpdatedAt: f.b.c.formUpdatedAt })),
    expected: "state:error:這張表單已有較新的版本或已不存在；系統沒有覆蓋它。請重新整理後確認內容。",
  },
  {
    name: "registration form (builder): create a form with tenant B's hero image asset",
    run: (f) => upsertFormBuilderAction(idle, builderForm({ heroImageAssetId: f.b.c.imageAssetId })),
    expected: "state:error:有幾個欄位需要調整；內容仍保留在畫面上。",
  },
  {
    name: "registration form (builder): create a form with tenant B's promo video",
    run: (f) => upsertFormBuilderAction(idle, builderForm({ promoVideoId: f.b.c.videoId })),
    expected: "state:error:有幾個欄位需要調整；內容仍保留在畫面上。",
  },
  {
    name: "message template: overwrite tenant B's template with B's own version stamp",
    run: (f) => upsertTemplateAction(initialMessageTemplateActionState, templateForm(f.b.c.messageTemplateId, f.b.c.messageTemplateUpdatedAt)),
    expected: "state-error:missing_template",
  },
  // Automations.
  {
    name: "automation recipe: issue vouchers for tenant B's product",
    run: (f) => createAutomationRecipeAction(formData({ recipeId: "vip_auto_tiering", productId: f.b.productId })),
    expected: "redirect:/settings/automations?error=invalid_product",
  },
  {
    name: "automation rule: create a voucher rule for tenant B's product",
    run: (f) => createAutomationRuleAction(ruleForm(f.b.productId)),
    expected: "redirect:/settings/automations?error=invalid_product",
  },
  {
    name: "automation rule: dry-run tenant B's rule",
    run: (f) => dryRunAutomationRuleAction(formData({ ruleId: f.b.ruleId, orderAmount: "100" })),
    expected: "redirect:/settings/automations?error=not_found",
  },
  // Evergreen and consultation settings.
  {
    name: "evergreen: rewrite tenant B's Live schedule settings",
    run: (f) => updateEvergreenWebinarSettingsAction(evergreenForm(f.b.liveId)),
    expected: "redirect:/lives?error=live_not_found",
  },
  {
    name: "consultation: edit tenant B's consultation service",
    run: (f) => updateConsultationEventAction(consultationForm(f.b.c.consultationEventId)),
    expected: "redirect:/consultations?error=not_found",
  },
  {
    name: "consultation: switch off tenant B's consultation service",
    run: (f) => toggleConsultationEventAction(formData({ eventId: f.b.c.consultationEventId, isActive: "false" })),
    expected: "redirect:/consultations?error=not_found",
  },
  // Funnel editor (landingPageAction, one action with nine operations) and Funnel settings.
  ...(["check_publish", "publish", "delete", "duplicate"] as const).map((operation): Row => ({
    name: `funnel editor: ${operation} tenant B's page`,
    run: (f) => landingPageAction(pageIdle, pageOperation(operation, f.b.c.funnelPageId)),
    expected: PAGE_NOT_FOUND,
  })),
  {
    name: "funnel editor: unpublish tenant B's published page",
    arrange: async (f) => {
      await db.landingPage.update({ where: { id: f.b.c.funnelPageId }, data: { status: "published", publishedAt: new Date() } });
      return noArrangement;
    },
    run: (f) => landingPageAction(pageIdle, pageOperation("unpublish", f.b.c.funnelPageId)),
    // A single vendor-scoped compare-and-set: a foreign, missing or stale page all read as a version conflict.
    expected: "state:error:這個頁面已有較新的版本，系統沒有覆蓋它。請重新整理後再試。",
  },
  {
    name: "funnel editor: save a draft over tenant B's page",
    run: (f) => landingPageAction(pageIdle, pageOperation("save", f.b.c.funnelPageId, { name: "外部草稿", slug: `foreign-${randomUUID()}`, content: funnelContent() })),
    expected: PAGE_NOT_FOUND,
  },
  {
    name: "funnel editor: rename a step of tenant B's page",
    run: (f) => landingPageAction(pageIdle, pageOperation("save_steps", f.b.c.funnelPageId, { mutation: JSON.stringify({ type: "rename", stepId: "step", name: "外部" }) })),
    expected: PAGE_NOT_FOUND,
  },
  {
    name: "funnel editor: roll tenant B's page back to a version",
    run: (f) => landingPageAction(pageIdle, pageOperation("rollback", f.b.c.funnelPageId, { version: "1" })),
    expected: PAGE_NOT_FOUND,
  },
  {
    name: "funnel editor: create a page bound to tenant B's registration form",
    run: (f) => landingPageAction(pageIdle, formData({ operation: "create", name: "外部表單", slug: `foreign-${randomUUID()}`, formId: f.b.c.liveFormId, content: funnelContent() })),
    expected: PAGE_INPUT_INVALID,
  },
  {
    name: "funnel editor: create a page bound to tenant B's Live",
    run: (f) => landingPageAction(pageIdle, formData({ operation: "create", name: "外部直播", slug: `foreign-${randomUUID()}`, liveId: f.b.liveId, content: funnelContent() })),
    expected: PAGE_INPUT_INVALID,
  },
  {
    name: "funnel settings: rewrite tenant B's Funnel name, slug and operations",
    run: (f) => updateFunnelOperations(funnelSettings(f.b.c.funnelPageId)),
    expected: "ok:false:找不到一頁式網站或沒有存取權限。",
  },
  // Brand and workspace settings.
  {
    name: "brand: use tenant B's image asset as tenant A's logo",
    run: (f) => saveBrandSettingsAction(brandForm({ logoAssetId: f.b.c.imageAssetId, logoUploadPhase: "success" })),
    expected: "redirect:/settings/brand?error=invalid_logo",
  },
  {
    name: "brand (state form): use tenant B's image asset as tenant A's logo",
    run: (f) => saveBrandSettingsActionState({ ...idle, values: {} as never }, brandForm({ logoAssetId: f.b.c.imageAssetId, logoUploadPhase: "success" })),
    expected: "state:error:品牌 Logo 圖片資產無效，請重新上傳。",
  },
  {
    name: "workspace: select tenant B's sales project",
    run: (f) => selectSalesProjectAction(f.b.projectId),
    expected: "error:project_not_found",
  },
  {
    name: "workspace: publish tenant B's sales project",
    run: (f) => publishSalesProjectAction(formData({ projectId: f.b.projectId })),
    expected: "error:project_not_found",
  },
];

const ownRows: Row[] = [
  {
    name: "live: save a draft over own Live with own resources",
    arrange: (f) => liveDraft(f, { videoId: f.a.c.videoId, formId: f.a.c.liveFormId, messageTemplateId: f.a.c.messageTemplateId, interactionScriptId: f.a.c.scriptId, heroImageAssetId: f.a.c.imageAssetId }, f.a.liveId),
    run: (_f, form) => upsertLiveAction(form),
    expected: "redirect:/lives/",
    verify: async (f) => {
      expect(await db.live.findUniqueOrThrow({ where: { id: f.a.liveId }, select: { title: true, videoId: true, formId: true, interactionScriptId: true } })).toEqual({
        title: "合成直播", videoId: f.a.c.videoId, formId: f.a.c.liveFormId, interactionScriptId: f.a.c.scriptId,
      });
    },
  },
  {
    name: "live poll: read and end own poll",
    run: async (f) => {
      const results = await getLivePollStudioSnapshotAction(f.a.liveId);
      expect(results).toEqual([expect.objectContaining({ id: f.a.c.pollRunId, title: f.a.c.pollTitle, responseCount: 1 })]);
      return endLiveInteractionAction(idle, formData({ runId: f.a.c.pollRunId }));
    },
    expected: "state:success:投票已提前結束",
    verify: async (f) => {
      expect((await db.liveInteractionRun.findUniqueOrThrow({ where: { id: f.a.c.pollRunId } })).status).toBe("closed");
    },
  },
  {
    name: "interaction role: rename own role (both forms) and delete another own role",
    run: async (f) => {
      expect(await outcome(() => upsertInteractionRoleActionState(initialInteractionRoleActionState, roleForm({ id: f.a.c.roleId, name: "狀態表單角色" })))).toBe("redirect:/interaction-roles");
      const spare = await db.interactionRole.create({ data: { vendorId: f.a.vendor.id, name: "待刪角色", roleType: "official" } });
      expect(await outcome(() => deleteInteractionRoleAction(formData({ id: spare.id })))).toBe("redirect:/interaction-roles/new");
      return upsertInteractionRoleAction(roleForm({ id: f.a.c.roleId, ...customAvatar(f.a.c.imageAssetId) }));
    },
    expected: "redirect:/interaction-roles",
    verify: async (f) => {
      expect((await db.interactionRole.findUniqueOrThrow({ where: { id: f.a.c.roleId } })).avatarUrl).toMatch(/^https:\/\/images\.example\.test\//u);
      expect(await db.interactionRole.count({ where: { vendorId: f.a.vendor.id } })).toBe(1);
    },
  },
  {
    name: "interaction script: save, duplicate, unbind and delete own script",
    run: async (f) => {
      expect(await outcome(() => upsertInteractionScriptAction(scriptForm({ id: f.a.c.scriptId }, chatEvent(f.a.c.roleId))))).toBe("redirect:/interaction-scripts");
      // The native transport unwraps only Next's redirect digest; the synthetic redirect surfaces as is.
      expect(await outcome(() => saveInteractionScript(scriptForm({}, { eventType: "product_spotlight", productId: f.a.productId })))).toBe("redirect:/interaction-scripts");
      expect(await outcome(() => duplicateInteractionScriptAction(formData({ id: f.a.c.scriptId })))).toBe("redirect:/interaction-scripts");
      expect(await outcome(() => unbindInteractionScriptFromLiveAction(formData({ id: f.a.c.scriptId, liveId: f.a.liveId })))).toBe("value:undefined");
      return deleteInteractionScriptAction(formData({ id: f.a.c.scriptId }));
    },
    expected: "redirect:/interaction-scripts",
    verify: async (f) => {
      expect(await db.interactionScript.count({ where: { vendorId: f.a.vendor.id } })).toBe(2);
      expect((await db.live.findUniqueOrThrow({ where: { id: f.a.liveId } })).interactionScriptId).toBeNull();
    },
  },
  {
    name: "video: edit, archive and restore own videos",
    run: async (f) => {
      expect(await outcome(() => upsertVideoAction(videoForm(f.a.c.videoId, { thumbnailAssetId: f.a.c.imageAssetId })))).toBe("redirect:/videos");
      expect(await outcome(() => archiveVideoAction(formData({ id: f.a.c.videoId })))).toBe("redirect:/videos");
      return restoreVideoAction(formData({ id: f.a.c.archivedVideoId }));
    },
    expected: "redirect:/videos",
    verify: async (f) => {
      expect((await db.video.findUniqueOrThrow({ where: { id: f.a.c.videoId } })).status).toBe("archived");
      expect((await db.video.findUniqueOrThrow({ where: { id: f.a.c.archivedVideoId } })).status).toBe("ready");
    },
  },
  {
    name: "registration form: edit own form in both editors",
    run: async (f) => {
      expect(await outcome(() => upsertFormBuilderAction(idle, builderForm({ id: f.a.formId, expectedUpdatedAt: f.a.c.formUpdatedAt, heroImageAssetId: f.a.c.imageAssetId, promoVideoId: f.a.c.videoId })))).toBe("redirect:/forms");
      return upsertFormAction(resourceForm(f.a.formId));
    },
    expected: "redirect:/forms",
    verify: async (f) => {
      expect((await db.registrationForm.findUniqueOrThrow({ where: { id: f.a.formId } })).name).toBe("改名表單");
    },
  },
  {
    name: "message template: edit own template",
    run: (f) => upsertTemplateAction(initialMessageTemplateActionState, templateForm(f.a.c.messageTemplateId, f.a.c.messageTemplateUpdatedAt)),
    expected: "redirect:/messages/templates",
    verify: async (f) => {
      expect((await db.messageTemplate.findUniqueOrThrow({ where: { id: f.a.c.messageTemplateId } })).name).toBe("改名範本");
    },
  },
  {
    name: "automation: create a recipe and a rule for own product, dry-run own rule",
    run: async (f) => {
      expect(await outcome(() => createAutomationRecipeAction(formData({ recipeId: "vip_auto_tiering", productId: f.a.productId })))).toBe("redirect:/settings/automations?updated=recipe_created");
      expect(await outcome(() => createAutomationRuleAction(ruleForm(f.a.productId)))).toBe("redirect:/settings/automations?updated=created");
      return dryRunAutomationRuleAction(formData({ ruleId: f.a.ruleId, orderAmount: "100" }));
    },
    expected: "redirect:/settings/automations?dryRun=",
    verify: async (f) => {
      expect(await db.automationRule.count({ where: { vendorId: f.a.vendor.id } })).toBe(3);
    },
  },
  {
    name: "evergreen: save own Live settings",
    run: (f) => updateEvergreenWebinarSettingsAction(evergreenForm(f.a.liveId)),
    expected: "?notice=evergreen_saved",
  },
  {
    name: "consultation: edit and switch off own service",
    run: async (f) => {
      expect(await outcome(() => updateConsultationEventAction(consultationForm(f.a.c.consultationEventId)))).toBe("redirect:/consultations?updated=saved");
      return toggleConsultationEventAction(formData({ eventId: f.a.c.consultationEventId, isActive: "false" }));
    },
    expected: "redirect:/consultations?updated=event_status",
    verify: async (f) => {
      expect(await db.consultationEvent.findUniqueOrThrow({ where: { id: f.a.c.consultationEventId } })).toMatchObject({ title: "改名諮詢", isActive: false });
    },
  },
  {
    name: "funnel editor: create with own form, save, duplicate and delete own pages",
    run: async (f) => {
      expect(await outcome(() => landingPageAction(pageIdle, formData({ operation: "create", name: "本商家頁", slug: `own-${randomUUID()}`, formId: f.a.c.liveFormId, content: funnelContent() })))).toBe("state:success:草稿已建立。");
      expect(await outcome(() => landingPageAction(pageIdle, pageOperation("save", f.a.c.funnelPageId, { name: "本商家草稿", slug: `own-${randomUUID()}`, content: funnelContent() })))).toBe("state:success:草稿已儲存。");
      expect(await outcome(() => landingPageAction(pageIdle, pageOperation("duplicate", f.a.c.funnelPageId)))).toBe("state:success:已建立草稿副本。");
      return landingPageAction(pageIdle, pageOperation("delete", f.a.c.funnelPageId, { revision: "2" }));
    },
    expected: "state:success:Funnel 與草稿已刪除。",
    verify: async (f) => {
      expect(await db.landingPage.count({ where: { id: f.a.c.funnelPageId } })).toBe(0);
    },
  },
  {
    name: "funnel editor: unpublish own published page",
    arrange: async (f) => {
      await db.landingPage.update({ where: { id: f.a.c.funnelPageId }, data: { status: "published", publishedAt: new Date() } });
      return noArrangement;
    },
    run: (f) => landingPageAction(pageIdle, pageOperation("unpublish", f.a.c.funnelPageId)),
    expected: "state:success:已取消發布",
    verify: async (f) => {
      expect(await db.landingPage.findUniqueOrThrow({ where: { id: f.a.c.funnelPageId }, select: { status: true, revision: true } })).toEqual({ status: "draft", revision: 2 });
    },
  },
  {
    name: "funnel settings: save own Funnel settings",
    run: async (f) => {
      const current = await readFunnelOperations(f.a.c.funnelPageId);
      return updateFunnelOperations(formData({
        settings: JSON.stringify({ pageId: current.pageId, revision: current.revision, name: "改名網站", slug: current.slug, currency: current.currency, operations: current.operations }),
      }));
    },
    expected: "ok:true:設定已儲存。",
    verify: async (f) => {
      expect((await db.landingPage.findUniqueOrThrow({ where: { id: f.a.c.funnelPageId } })).name).toBe("改名網站");
    },
  },
  {
    name: "brand: save own brand settings with own logo (a forged vendor id field is ignored)",
    run: async (f) => {
      expect(await outcome(() => saveBrandSettingsActionState({ ...idle, values: {} as never }, brandForm({ logoAssetId: f.a.c.imageAssetId, logoUploadPhase: "success" })))).toBe("redirect:/settings/brand");
      return saveBrandSettingsAction(brandForm({ name: "本商家品牌", vendorId: f.b.vendor.id, id: f.b.vendor.id, logoAssetId: f.a.c.imageAssetId, logoUploadPhase: "success" }));
    },
    expected: "value:undefined",
    verify: async (f) => {
      expect(await db.vendor.findUniqueOrThrow({ where: { id: f.a.vendor.id }, select: { name: true, logoUrl: true } })).toEqual({
        name: "本商家品牌", logoUrl: expect.stringMatching(/^https:\/\/images\.example\.test\//u),
      });
    },
  },
  {
    name: "workspace: select own second project",
    run: (f) => selectSalesProjectAction(f.a.c.secondProjectId),
    expected: "value:undefined",
    verify: async (f) => {
      expect((await db.userOnboardingPreference.findFirstOrThrow({ where: { vendorId: f.a.vendor.id, userId: f.a.actors.owner.user.id } })).selectedProjectId).toBe(f.a.c.secondProjectId);
    },
  },
  {
    name: "workspace: publish own ready sales project",
    run: async (f) => {
      await db.salesProjectProduct.create({ data: { vendorId: f.a.vendor.id, projectId: f.a.projectId, productId: f.a.productId } });
      await db.paymentMethodReference.create({
        data: { vendorId: f.a.vendor.id, scopeType: "VENDOR", providerName: "demo", providerPaymentMethodRef: `pm-${randomUUID()}`, status: "verified", verifiedAt: new Date() },
      });
      return publishSalesProjectAction(formData({ projectId: f.a.projectId }));
    },
    expected: "?published=1",
    verify: async (f) => {
      expect((await db.salesProject.findUniqueOrThrow({ where: { id: f.a.projectId } })).status).toBe("published");
    },
  },
];

async function buildFixture() {
  fixture = await createTwoTenantFixture(db);
  content = { a: await addTenantContent(db, fixture.a, "A"), b: await addTenantContent(db, fixture.b, "B") };
}

/**
 * Foreign rows prove that nothing changes, so they share one fixture (a row
 * that wrongly wrote would fail its own snapshot assertion first). Own rows
 * write, so each gets a fresh fixture.
 */
function sharedFixture() {
  beforeAll(buildFixture);
  afterAll(async () => fixture?.cleanup());
}
function freshFixture() {
  beforeEach(buildFixture);
  afterEach(async () => fixture?.cleanup());
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.cookies = [];
});
afterAll(async () => {
  await db.$disconnect();
});

function view(): Fix {
  return { a: { ...fixture.a, c: content.a }, b: { ...fixture.b, c: content.b } };
}

/** The actor's vendor with every module and beta feature on, in the tenant's time zone. */
function prepare(actor: TenantActor) {
  const enabled = withAllFeatures(actor);
  runtime.actor = { ...enabled, vendor: { ...enabled.vendor, timezone: "Asia/Taipei" } };
}

/** Tenant B content that a refusal must never hand back to tenant A. */
function secretsOf(t: Tenant) {
  return [t.c.pollTitle, "Script B", "Role B", "Video B", "Funnel B", "Template B", "B 標題", t.c.team.shareCode];
}

describe("second-tenant matrix (content and settings): foreign identifiers are refused and nothing is written", () => {
  sharedFixture();

  it.each(foreignRows.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    const f = view();
    prepare((row.actor ?? owner)(f));
    const arranged = row.arrange ? await row.arrange(f) : noArrangement;
    const [beforeA, beforeB] = [await snapshot(f.a.vendor.id), await snapshot(f.b.vendor.id)];

    const result = await outcome(() => row.run(f, arranged));
    expect(result).toContain(row.expected);
    for (const secret of secretsOf(f.b)) expect(result).not.toContain(secret);

    expect(await snapshot(f.b.vendor.id)).toBe(beforeB);
    expect(await snapshot(f.a.vendor.id)).toBe(beforeA);
    expect(mocks.scheduleImmediateEmailDispatch).not.toHaveBeenCalled();
    expect(mocks.dispatchLiveStarted).not.toHaveBeenCalled();
    expect(mocks.scheduleEvergreenRematerialization).not.toHaveBeenCalled();
  });

  it("foreign and missing ids are indistinguishable", async () => {
    const f = view();
    prepare(owner(f));
    const missing = "missing-synthetic-id";
    const same = async (foreign: () => Promise<unknown>, absent: () => Promise<unknown>) => {
      expect(await outcome(foreign)).toBe(await outcome(absent));
    };
    await same(() => upsertFormAction(resourceForm(f.b.formId)), () => upsertFormAction(resourceForm(missing)));
    await same(() => upsertVideoAction(videoForm(f.b.c.videoId)), () => upsertVideoAction(videoForm(missing)));
    await same(() => deleteInteractionRoleAction(formData({ id: f.b.c.roleId })), () => deleteInteractionRoleAction(formData({ id: missing })));
    await same(() => deleteInteractionScriptAction(formData({ id: f.b.c.scriptId })), () => deleteInteractionScriptAction(formData({ id: missing })));
    await same(() => duplicateInteractionScriptAction(formData({ id: f.b.c.scriptId })), () => duplicateInteractionScriptAction(formData({ id: missing })));
    // A3-02: both are an explicit error, not the success redirect to the list.
    expect(await outcome(() => duplicateInteractionScriptAction(formData({ id: missing })))).toBe("redirect:/interaction-scripts?error=missing_script");
    await same(() => endLiveInteractionAction(idle, formData({ runId: f.b.c.pollRunId })), () => endLiveInteractionAction(idle, formData({ runId: missing })));
    await same(() => landingPageAction(pageIdle, pageOperation("publish", f.b.c.funnelPageId)), () => landingPageAction(pageIdle, pageOperation("publish", missing)));
    await db.landingPage.update({ where: { id: f.b.c.funnelPageId }, data: { status: "published", publishedAt: new Date() } });
    await same(() => landingPageAction(pageIdle, pageOperation("unpublish", f.b.c.funnelPageId)), () => landingPageAction(pageIdle, pageOperation("unpublish", missing)));
    expect((await db.landingPage.findUniqueOrThrow({ where: { id: f.b.c.funnelPageId } })).status).toBe("published");
    await same(() => updateFunnelOperations(funnelSettings(f.b.c.funnelPageId)), () => updateFunnelOperations(funnelSettings(missing)));
    await same(() => updateConsultationEventAction(consultationForm(f.b.c.consultationEventId)), () => updateConsultationEventAction(consultationForm(missing)));
    await same(() => upsertTemplateAction(initialMessageTemplateActionState, templateForm(f.b.c.messageTemplateId, f.b.c.messageTemplateUpdatedAt)), () => upsertTemplateAction(initialMessageTemplateActionState, templateForm(missing, f.b.c.messageTemplateUpdatedAt)));
  });
});

describe("second-tenant matrix (content and settings): the same actions with own identifiers go through", () => {
  freshFixture();

  it.each(ownRows.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    const f = view();
    prepare((row.actor ?? owner)(f));
    const arranged = row.arrange ? await row.arrange(f) : noArrangement;
    const beforeB = await snapshot(f.b.vendor.id);

    const result = await outcome(() => row.run(f, arranged));
    expect(result).toContain(row.expected);
    await row.verify?.(f);

    // An own-tenant success never leaks into the other tenant.
    expect(await snapshot(f.b.vendor.id)).toBe(beforeB);
  });
});

describe("billing plan selection (platform catalog, n.a. for foreign ids) only ever changes the session vendor", () => {
  freshFixture();

  it("selecting a free plan replaces tenant A's subscription and leaves tenant B's active and pending subscriptions alone", async () => {
    const f = view();
    const key = randomUUID();
    const [free, other] = await Promise.all([
      db.billingPlan.create({ data: { name: "合成免費方案", code: `tt-free-${key}`, monthlyPriceCents: 0, includedCredits: 10 } }),
      db.billingPlan.create({ data: { name: "合成付費方案", code: `tt-paid-${key}`, monthlyPriceCents: 100_000 } }),
    ]);
    for (const t of [f.a, f.b]) {
      await db.vendorSubscription.create({ data: { vendorId: t.vendor.id, planId: other.id, paymentMode: "platform", status: "active" } });
      await db.vendorSubscription.create({ data: { vendorId: t.vendor.id, planId: other.id, paymentMode: "platform", status: "pending_payment" } });
    }
    prepare(f.a.actors.owner);
    const beforeB = await snapshot(f.b.vendor.id);

    // The plan id is shared catalog data; a forged vendor id field is not read.
    expect(await outcome(() => selectBillingPlanAction(formData({ planId: free.id, vendorId: f.b.vendor.id })))).toBe("redirect:/billing/plans?status=changed");

    expect(await snapshot(f.b.vendor.id)).toBe(beforeB);
    expect((await db.vendorSubscription.findMany({ where: { vendorId: f.a.vendor.id }, orderBy: { status: "asc" } })).map((row) => [row.planId, row.status])).toEqual([
      [free.id, "active"],
      [other.id, "ended"],
      [other.id, "payment_superseded"],
    ]);
    expect(await db.vendorUsageLimit.findUniqueOrThrow({ where: { vendorId: f.a.vendor.id } })).toMatchObject({ billingPlanId: free.id, creditsLimit: 10 });
    expect(await db.vendorUsageLimit.count({ where: { vendorId: f.b.vendor.id } })).toBe(0);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });
});
