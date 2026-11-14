import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/vendor-feature-toggles";
import { hashInteractionBearer } from "@/lib/live-interaction";
import {
  DERIVED_KEY_ROTATIONS,
  issuedBeforeRotation,
  macCandidatesWithRotation,
  recordLegacyDerivedKeyUse,
  signWithRotation,
} from "@/lib/derived-key-rotation";
import { automationCustomerKeyHash } from "@/lib/customer-key-hash";
import { createEmailRecipientHash, createEmailUnsubscribeUrl, protectEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { ensureEmailUnsubscribeFooter } from "@/lib/email-delivery-format";
import { isEmailBlacklistedForVendor } from "@/lib/email-blacklist";
import { AUTOMATION_EMAIL_TRIGGER, AUTOMATION_STEP_EMAIL_TRIGGER } from "@/lib/automation-email-trigger";
import { captureOperationalError } from "@/lib/monitoring";
import { scheduleImmediateEmailDispatch } from "@/lib/email-delivery-immediate";
import { isSafeExternalHttpsUrl } from "@/lib/safe-url";
import {
  buildAutomationLineMessage,
  enqueueLineNotification,
  stableLineIdempotencyKey,
} from "@/lib/line-notification";

/**
 * Every trigger the engine understands. Stored rules may use any of them and
 * keep parsing, so this list never shrinks; what a merchant may choose is
 * AVAILABLE_AUTOMATION_TRIGGERS below.
 */
export const AUTOMATION_TRIGGERS = [
  "payment_paid",
  "viewer_watch_progress",
  "webinar_attended_duration_gte",
  "form_registered",
  "consultation_booked",
  "consultation_no_show",
  "form_no_show",
] as const;
export type AutomationTrigger = typeof AUTOMATION_TRIGGERS[number];

/**
 * The single list of triggers a merchant may put on a new rule, or switch a
 * rule on with (F-4 gap 2). The UI and every Server Action read it.
 *
 * Only these three have a production caller today (form submission route and
 * the two consultation actions). `form_no_show`, `viewer_watch_progress` and
 * `webinar_attended_duration_gte` have none, so a rule using them would never
 * run. `payment_paid` has none either: the next F-4 PR wires it into the
 * payment flow (with its own independent review) and adds it back here.
 * Existing rules with a hidden trigger stay listed and can be switched off or
 * deleted, but not created, switched on or edited into one.
 */
export const AVAILABLE_AUTOMATION_TRIGGERS = [
  "form_registered",
  "consultation_booked",
  "consultation_no_show",
] as const satisfies readonly AutomationTrigger[];
export type AvailableAutomationTrigger = typeof AVAILABLE_AUTOMATION_TRIGGERS[number];

export function isAvailableAutomationTrigger(value: unknown): value is AvailableAutomationTrigger {
  return typeof value === "string" && (AVAILABLE_AUTOMATION_TRIGGERS as readonly string[]).includes(value);
}

export function isAutomationTrigger(value: unknown): value is AutomationTrigger {
  return typeof value === "string" && (AUTOMATION_TRIGGERS as readonly string[]).includes(value);
}

const THRESHOLD_TRIGGERS: ReadonlySet<string> = new Set(["payment_paid", "viewer_watch_progress", "webinar_attended_duration_gte"]);

/** Whether a rule on this trigger takes an amount or watch-seconds threshold. */
export function automationTriggerNeedsThreshold(trigger: string) {
  return THRESHOLD_TRIGGERS.has(trigger);
}

export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  payment_paid: "訂單付款完成",
  viewer_watch_progress: "觀看進度更新",
  webinar_attended_duration_gte: "觀看累積秒數達標",
  form_registered: "表單報名成功",
  consultation_booked: "諮詢預約成功",
  consultation_no_show: "諮詢未出席",
  form_no_show: "報名但未出席直播",
};

// Re-exported so existing callers keep one import path; the implementation
// lives in a dependency-free module the order PII boundary also imports.
export { automationCustomerKeyHash };

const AutomationConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("always") }).strict(),
  z.object({ type: z.literal("order_amount_gte"), amountCents: z.number().int().min(1) }).strict(),
  z.object({ type: z.literal("watch_seconds_gte"), seconds: z.number().int().min(1).max(86_400) }).strict(),
  z.object({ type: z.literal("watch_seconds_gte_and_not_purchased"), seconds: z.number().int().min(1).max(86_400) }).strict(),
]);

const AUTOMATION_URL_PLACEHOLDERS = new Set(["{{voucher_url}}", "{{consultation_url}}", "{{webinar_url}}"]);

/**
 * Send-time check for stored rules. Deliberately the original, looser rule so
 * automations saved before the stricter create-time check keep sending.
 */
function isSafeAutomationButtonUrl(value: string | null | undefined) {
  if (!value || AUTOMATION_URL_PLACEHOLDERS.has(value)) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Create-time check for a new LINE button URL: an approved placeholder or a
 * plain HTTPS URL with a host and no credentials, so a button cannot read as
 * "https://brand.example@evil.example".
 */
export function isSafeNewAutomationButtonUrl(value: string | null | undefined) {
  return !value || AUTOMATION_URL_PLACEHOLDERS.has(value) || isSafeExternalHttpsUrl(value);
}

export const AUTOMATION_BUTTON_URL_ERROR_MESSAGE = "LINE 按鈕網址只接受 HTTPS 網址（不可包含帳號或密碼，例如「名稱@網域」），或 {{voucher_url}}、{{consultation_url}}、{{webinar_url}}。";

const AutomationActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("line_push"),
    message: z.string().trim().min(1).max(1_500),
    buttonLabel: z.string().trim().min(1).max(40).nullable().optional(),
    buttonUrl: z.string().trim().max(2_000).nullable().optional(),
  }).strict(),
  z.object({
    type: z.literal("issue_repurchase_voucher"),
    productId: z.string().min(1).max(128),
    discountType: z.enum(["fixed", "percentage"]),
    discountValue: z.number().int().min(1).max(100_000_000),
    expiresInDays: z.number().int().min(1).max(365),
  }).strict(),
  z.object({ type: z.literal("add_customer_tag"), tag: z.string().trim().min(1).max(50) }).strict(),
  z.object({
    type: z.literal("send_email_notification"),
    template: z.enum(["consultation_confirmation", "class_reminder", "repurchase_followup", "webinar_replay"]),
  }).strict(),
]).refine((action) => action.type !== "issue_repurchase_voucher" || action.discountType !== "percentage" || action.discountValue <= 99, {
  message: "Percentage vouchers must remain below 100%.",
}).refine((action) => action.type !== "line_push" || isSafeAutomationButtonUrl(action.buttonUrl), {
  message: "LINE button URL must be HTTPS or use an approved placeholder.",
});

export type AutomationCondition = z.infer<typeof AutomationConditionSchema>;
export type AutomationAction = z.infer<typeof AutomationActionSchema>;

export const AUTOMATION_RECIPES = [
  {
    id: "high_intent_chaser",
    name: "高意向追單漏斗",
    description: "觀看滿 30 分鐘且尚未購買，自動派發 9 折券並用 LINE 追單。",
    trigger: "webinar_attended_duration_gte",
    condition: { type: "watch_seconds_gte_and_not_purchased", seconds: 1_800 },
    actions: [
      { type: "issue_repurchase_voucher", productId: "{{product_id}}", discountType: "percentage", discountValue: 10, expiresInDays: 3 },
      { type: "line_push", message: "您離突破只差最後一步！贈送您專屬 9 折加碼折扣 {{voucher_url}}", buttonLabel: "領取專屬折扣", buttonUrl: "{{voucher_url}}" },
    ],
  },
  {
    id: "consultation_confirmer",
    name: "諮詢預約提醒與防爽約",
    description: "預約成功後加上諮詢標籤，並寄送 Email 與 LINE 確認。",
    trigger: "consultation_booked",
    condition: { type: "always" },
    actions: [
      { type: "add_customer_tag", tag: "諮詢學員" },
      { type: "send_email_notification", template: "consultation_confirmation" },
      { type: "line_push", message: "您的 1 對 1 諮詢已預約成功，請加入行事曆。{{consultation_url}}", buttonLabel: "查看預約", buttonUrl: "{{consultation_url}}" },
    ],
  },
  {
    id: "vip_auto_tiering",
    name: "高客單 VIP 自動尊榮升級",
    description: "單筆付款滿 NT$30,000，自動升級 VIP 並派發回購券。",
    trigger: "payment_paid",
    condition: { type: "order_amount_gte", amountCents: 3_000_000 },
    actions: [
      { type: "add_customer_tag", tag: "VIP 客戶" },
      { type: "issue_repurchase_voucher", productId: "{{product_id}}", discountType: "percentage", discountValue: 10, expiresInDays: 30 },
    ],
  },
  {
    id: "no_show_reactivation",
    name: "開播缺席喚醒再行銷",
    description: "報名卻未出席時，自動寄送回放與 1 對 1 諮詢邀請。",
    trigger: "form_no_show",
    condition: { type: "always" },
    actions: [{ type: "send_email_notification", template: "webinar_replay" }],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  condition: unknown;
  actions: readonly unknown[];
}>;

export type AutomationRecipeId = typeof AUTOMATION_RECIPES[number]["id"];

/** Recipes offered to merchants: only those whose trigger can run today. */
export const AVAILABLE_AUTOMATION_RECIPES = AUTOMATION_RECIPES.filter((recipe) => isAvailableAutomationTrigger(recipe.trigger));

export function materializeAutomationRecipe(recipeId: string, productId?: string) {
  const recipe = AUTOMATION_RECIPES.find((candidate) => candidate.id === recipeId);
  if (!recipe) return null;
  const raw = JSON.parse(JSON.stringify(recipe)) as typeof recipe;
  const actions = raw.actions.map((action) => {
    if (typeof action === "object" && action && "productId" in action && action.productId === "{{product_id}}") {
      return { ...action, productId };
    }
    return action;
  });
  const parsed = parseAutomationRule({ id: recipe.id, condition: raw.condition, actions });
  return parsed ? { name: recipe.name, description: recipe.description, trigger: recipe.trigger, condition: parsed.condition, actions: parsed.actions } : null;
}

export function maskAutomationTarget(value: string | null | undefined) {
  if (!value) return "—";
  const normalized = value.trim();
  if (normalized.includes("@")) {
    const [local = "", domain = ""] = normalized.split("@");
    return `${local.slice(0, 1)}***@${domain}`;
  }
  return normalized.length <= 8 ? `${normalized.slice(0, 2)}***` : `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}

const EMAIL_SKIP_NOTES: Record<AutomationEmailSkipReason, string> = {
  recipient_suppressed: "Email 未寄出：收件人已退訂或停止接收",
  recipient_blacklisted: "Email 未寄出：收件人在本商家黑名單中",
  recipient_unverified: "Email 未寄出：收件人的 Email 尚未在本商家完成驗證",
};

/** Reason of a failed automation e-mail action whose unsubscribe link could not be built. */
export const AUTOMATION_UNSUBSCRIBE_URL_UNAVAILABLE = "unsubscribe_url_unavailable";

/** Merchant-readable notes for e-mail actions an execution skipped or could not queue (stored actionResults are untrusted JSON). */
export function automationExecutionNotes(actionResults: unknown) {
  // A delayed step's log keeps { actions, results } (see stepActionResults).
  const results = Array.isArray(actionResults)
    ? actionResults
    : actionResults && typeof actionResults === "object" && Array.isArray((actionResults as { results?: unknown }).results)
      ? (actionResults as { results: unknown[] }).results
      : null;
  if (!results) return [];
  const notes = results.flatMap((result) => {
    if (!result || typeof result !== "object") return [];
    const { type, status, reason } = result as Record<string, unknown>;
    if (type !== "send_email_notification") return [];
    if (status === "failed" && reason === AUTOMATION_UNSUBSCRIBE_URL_UNAVAILABLE) return ["Email 未寄出：系統暫時無法產生退訂連結"];
    if (status !== "skipped") return [];
    return reason === "recipient_suppressed" || reason === "recipient_blacklisted" || reason === "recipient_unverified" ? [EMAIL_SKIP_NOTES[reason]] : [];
  });
  return [...new Set(notes)];
}

export type AutomationEvent = {
  vendorId: string;
  eventId: string;
  trigger: AutomationTrigger;
  /**
   * A trusted LandingPage id supplied by the server-side funnel submission
   * path. It is optional so vendor-wide rules retain their existing behaviour
   * for events that do not originate from a funnel.
   */
  funnelPageId?: string;
  /** Trusted server-resolved Live scope for watch automations. */
  liveId?: string;
  subjectType: "buyer_order" | "buyer_registration" | "viewer_session";
  subjectId: string;
  subjectKeyHash: string;
  orderAmountCents?: number;
  currency?: string;
  watchSecondsTotal?: number;
  hasPurchased?: boolean;
  recipientEmail?: string;
  /**
   * Delayed steps only (F-4): false when nobody has confirmed `recipientEmail`
   * (an unverified registration, or a booking whose address has no verified
   * registration at this vendor). The e-mail action is then skipped as
   * `recipient_unverified`; the other actions still run. Immediate rules
   * never set it and keep their behaviour.
   */
  recipientVerified?: boolean;
  consultationUrl?: string;
  webinarUrl?: string;
};

type AutomationDb = Pick<
  PrismaClient,
  "automationRule" | "automationExecutionLog" | "automationVoucherGrant" | "customerTagAssignment" | "product" | "lineOfficialAccount" | "lineUserIdentity" | "lineDelivery" | "emailDelivery" | "emailSuppression" | "blacklist" | "delayedStepRun" | "formSubmission" | "consultationBooking" | "vendor" | "$transaction"
>;

/** Closed-beta grant of delayed automation steps (F-4, M3). */
export const AUTOMATION_DELAYED_STEPS_FEATURE = "automation_delayed_steps" as const;

type ParsedRule = {
  id: string;
  version: number;
  condition: AutomationCondition;
  actions: AutomationAction[];
};

export function parseAutomationRule(input: { id: string; version?: number; condition: unknown; actions: unknown }): ParsedRule | null {
  const condition = AutomationConditionSchema.safeParse(input.condition);
  const actions = z.array(AutomationActionSchema).min(1).max(10).safeParse(input.actions);
  return condition.success && actions.success
    ? { id: input.id, version: input.version ?? 1, condition: condition.data, actions: actions.data }
    : null;
}

export function automationConditionMatches(condition: AutomationCondition, event: AutomationEvent) {
  if (condition.type === "always") return true;
  if (condition.type === "order_amount_gte") {
    return event.trigger === "payment_paid" && (event.orderAmountCents ?? -1) >= condition.amountCents;
  }
  const isWatchTrigger = event.trigger === "viewer_watch_progress" || event.trigger === "webinar_attended_duration_gte";
  if (condition.type === "watch_seconds_gte_and_not_purchased") {
    return isWatchTrigger && event.hasPurchased === false && (event.watchSecondsTotal ?? -1) >= condition.seconds;
  }
  return isWatchTrigger && (event.watchSecondsTotal ?? -1) >= condition.seconds;
}

export function dryRunAutomationRule(input: { condition: unknown; actions: unknown }, event: AutomationEvent) {
  const rule = parseAutomationRule({ id: "dry-run", condition: input.condition, actions: input.actions });
  if (!rule) return { status: "invalid_rule" as const, conditionMatched: false, actionTypes: [] as string[] };
  const conditionMatched = automationConditionMatches(rule.condition, event);
  return {
    status: conditionMatched ? "would_dispatch" as const : "would_skip" as const,
    conditionMatched,
    actionTypes: conditionMatched ? rule.actions.map((action) => action.type) : [],
  };
}

function executionIdempotencyKey(rule: ParsedRule, event: AutomationEvent) {
  // Provider retries do not always reuse the same webhook event id. Bind both
  // supported triggers to their durable business subject so one paid order (or
  // one viewer crossing a threshold) cannot execute the same rule twice.
  const eventIdentity = event.trigger === "viewer_watch_progress" || event.trigger === "webinar_attended_duration_gte"
    ? `viewer:${event.liveId}:${event.subjectKeyHash}:version:${rule.version}`
    : `order:${event.subjectId}:version:${rule.version}`;
  return createHash("sha256").update(`automation:v1:${event.vendorId}:${rule.id}:${event.trigger}:${eventIdentity}`).digest("hex");
}

function deterministicActionId(executionLogId: string, actionIndex: number) {
  return `aut_${createHash("sha256").update(`${executionLogId}:${actionIndex}`).digest("hex").slice(0, 28)}`;
}

// Rotated after #485 (tier 3). New grants use the new key. A grant row stores
// only the bearer's hash, so links already sent keep working until the voucher
// expires; the legacy key is needed only to rebuild the link of a pre-rotation
// grant when its execution is retried (until the hard stop in
// derived-key-purposes.ts).
const VOUCHER_BEARER_KEY = DERIVED_KEY_ROTATIONS.automationVoucherBearer;

function voucherBearerMessage(executionLogId: string, actionIndex: number) {
  return `${executionLogId}:${actionIndex}`;
}

function deterministicVoucherBearer(executionLogId: string, actionIndex: number) {
  return signWithRotation(VOUCHER_BEARER_KEY, voucherBearerMessage(executionLogId, actionIndex));
}

/**
 * The bearer an existing grant row was created with, current key first. The
 * legacy key only counts for a grant created before the rotation took effect.
 */
function existingVoucherBearer(executionLogId: string, actionIndex: number, grant: { claimTokenHash: string; createdAt: Date }) {
  const match = macCandidatesWithRotation(VOUCHER_BEARER_KEY, voucherBearerMessage(executionLogId, actionIndex))
    .filter((candidate) => candidate.version === "current" || issuedBeforeRotation(grant.createdAt.getTime()))
    .find((candidate) => hashInteractionBearer(candidate.mac) === grant.claimTokenHash);
  if (match?.version === "legacy") recordLegacyDerivedKeyUse(VOUCHER_BEARER_KEY.label);
  return match?.mac ?? null;
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isForeignKeyViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

function isRecordNotFound(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

/**
 * Records how an execution ended. Returns false when its log row is gone:
 * the only way is a cascade from deleting the rule (or the vendor) while it
 * ran, and that rule is then simply over for this event.
 */
async function finishExecution(db: AutomationDb, logId: string, data: Prisma.AutomationExecutionLogUpdateInput) {
  try {
    await db.automationExecutionLog.update({ where: { id: logId }, data });
    return true;
  } catch (error) {
    if (isRecordNotFound(error)) return false;
    throw error;
  }
}

function replaceArtifacts(value: string | null | undefined, artifacts: { voucherUrl?: string; consultationUrl?: string; webinarUrl?: string }) {
  if (!value) return value ?? null;
  return value
    .replaceAll("{{voucher_url}}", artifacts.voucherUrl ?? "")
    .replaceAll("{{consultation_url}}", artifacts.consultationUrl ?? "")
    .replaceAll("{{webinar_url}}", artifacts.webinarUrl ?? "");
}

const EMAIL_COPY = {
  consultation_confirmation: { subject: "1 對 1 諮詢預約確認", body: "您的諮詢已預約成功。請將時間加入行事曆，並由下方連結進入：\n{{consultation_url}}" },
  class_reminder: { subject: "課程即將開始", body: "課程即將開始，請由下方連結進入：\n{{webinar_url}}" },
  repurchase_followup: { subject: "為您保留的專屬優惠", body: "謝謝您的參與，專屬優惠請由下方連結領取：\n{{voucher_url}}" },
  webinar_replay: { subject: "錯過直播也別擔心：精華回放與諮詢邀請", body: "精華回放：{{webinar_url}}\n預約 1 對 1 諮詢：{{consultation_url}}" },
} as const;

export type AutomationEmailSkipReason = "recipient_suppressed" | "recipient_blacklisted" | "recipient_unverified";

/**
 * Creation-time gate for an automation e-mail, bound to this vendor only:
 * an unsubscribe (or other EmailSuppression not yet resubscribed) or an
 * active merchant Email blacklist entry stops it. Another vendor's lists
 * never apply.
 */
async function automationEmailRecipientBlock(
  db: Pick<AutomationDb, "emailSuppression" | "blacklist">,
  vendorId: string,
  recipientEmail: string,
  recipientHash: string,
): Promise<AutomationEmailSkipReason | null> {
  const [suppression, blacklisted] = await Promise.all([
    db.emailSuppression.findUnique({
      where: { vendorId_recipientHash: { vendorId, recipientHash } },
      select: { resubscribedAt: true },
    }),
    isEmailBlacklistedForVendor(db, vendorId, recipientEmail),
  ]);
  if (suppression && !suppression.resubscribedAt) return "recipient_suppressed";
  if (blacklisted) return "recipient_blacklisted";
  return null;
}

type ActionContext = {
  /**
   * `EmailDelivery.trigger` of the e-mails this execution queues: immediate
   * rules use AUTOMATION_EMAIL_TRIGGER, delayed steps
   * AUTOMATION_STEP_EMAIL_TRIGGER (dispatched on the sequence quota).
   */
  emailTrigger: string;
};

async function executeAction(
  db: AutomationDb,
  rule: ParsedRule,
  event: AutomationEvent,
  executionLogId: string,
  action: AutomationAction,
  actionIndex: number,
  artifacts: { voucherUrl?: string; consultationUrl?: string; webinarUrl?: string },
  queuedEmailIds: string[],
  context: ActionContext,
) {
  if (action.type === "add_customer_tag") {
    const tag = action.tag.trim().toLocaleLowerCase("zh-TW");
    await db.customerTagAssignment.upsert({
      where: { vendorId_customerKeyHash_tag: { vendorId: event.vendorId, customerKeyHash: event.subjectKeyHash, tag } },
      create: { vendorId: event.vendorId, customerKeyHash: event.subjectKeyHash, tag, sourceExecutionLogId: executionLogId },
      update: {},
    });
    return { type: action.type, status: "tagged", tag } as const;
  }

  if (action.type === "issue_repurchase_voucher") {
    if (event.subjectType === "viewer_session") return { type: action.type, status: "recipient_not_linked" } as const;
    const product = await db.product.findFirst({
      where: { id: action.productId, vendorId: event.vendorId, isActive: true },
      select: { id: true, currency: true },
    });
    if (!product) return { type: action.type, status: "product_unavailable" } as const;
    const id = deterministicActionId(executionLogId, actionIndex);
    const bearer = deterministicVoucherBearer(executionLogId, actionIndex);
    try {
      await db.automationVoucherGrant.create({
        data: {
          id,
          vendorId: event.vendorId,
          customerKeyHash: event.subjectKeyHash,
          productId: product.id,
          claimTokenHash: hashInteractionBearer(bearer),
          discountType: action.discountType,
          discountValue: action.discountValue,
          currency: product.currency,
          sourceExecutionLogId: executionLogId,
          expiresAt: new Date(Date.now() + action.expiresInDays * 86_400_000),
        },
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const existing = await db.automationVoucherGrant.findUnique({
        where: { id },
        select: { vendorId: true, claimTokenHash: true, createdAt: true },
      });
      const existingBearer = existing?.vendorId === event.vendorId
        ? existingVoucherBearer(executionLogId, actionIndex, existing)
        : null;
      // Never send a link that cannot redeem: fail the execution instead (for
      // example a pre-rotation grant retried after the legacy key was retired).
      if (!existingBearer) throw new Error("Existing voucher grant matches no accepted bearer key.");
      const voucherUrl = new URL("/api/automation/vouchers/redeem", getCanonicalAppUrl());
      voucherUrl.searchParams.set("token", existingBearer);
      artifacts.voucherUrl = voucherUrl.toString();
      return { type: action.type, status: "already_issued" } as const;
    }
    const voucherUrl = new URL("/api/automation/vouchers/redeem", getCanonicalAppUrl());
    voucherUrl.searchParams.set("token", bearer);
    artifacts.voucherUrl = voucherUrl.toString();
    return { type: action.type, status: "issued", grantId: id } as const;
  }

  if (action.type === "send_email_notification") {
    if (!event.recipientEmail) return { type: action.type, status: "recipient_not_linked" } as const;
    // Delayed steps never mail an address nobody has confirmed (F-4, M2).
    if (event.recipientVerified === false) {
      return { type: action.type, status: "skipped", reason: "recipient_unverified", template: action.template } as const;
    }
    const id = deterministicActionId(executionLogId, actionIndex);
    const copy = EMAIL_COPY[action.template];
    // The recipient lists come first, so an unsubscribed or blacklisted
    // person is recorded as skipped even when the link below cannot be built.
    const blocked = await automationEmailRecipientBlock(db, event.vendorId, event.recipientEmail, createEmailRecipientHash(event.recipientEmail, event.vendorId));
    if (blocked) {
      // Not an error: the execution completes and the log records why, so
      // nothing retries it. dispatchEmailDelivery checks both again at send.
      return { type: action.type, status: "skipped", reason: blocked, template: action.template } as const;
    }
    // Marketing mail (F-4 gap 1): the same signed /unsubscribe link and
    // footer as sequence e-mails. The token names this delivery, so the
    // unsubscribe lands on this vendor's EmailSuppression only.
    let unsubscribeUrl: string;
    try {
      unsubscribeUrl = createEmailUnsubscribeUrl(id);
    } catch (error) {
      // Missing public URL or signing key: never queue the mail without its
      // link. This action fails on its own; the rest of the rule still runs
      // and the execution is recorded as failed (see runAutomationEvent).
      captureOperationalError(error, { area: "automation_email", operation: "unsubscribe_url", vendorId: event.vendorId });
      return { type: action.type, status: "failed", reason: AUTOMATION_UNSUBSCRIBE_URL_UNAVAILABLE, template: action.template } as const;
    }
    const protectedPayload = protectEmailDeliveryPayload({
      recipientEmail: event.recipientEmail,
      subject: copy.subject,
      body: ensureEmailUnsubscribeFooter(replaceArtifacts(copy.body, artifacts) ?? copy.body, unsubscribeUrl),
    }, { vendorId: event.vendorId, deliveryId: id });
    try {
      await db.emailDelivery.create({ data: {
        id,
        vendorId: event.vendorId,
        sourceTemplateId: `automation_${action.template}_v1`,
        trigger: context.emailTrigger,
        ...protectedPayload,
        idempotencyKey: stableLineIdempotencyKey(["automation-email", executionLogId, actionIndex]),
        status: "queued",
        nextAttemptAt: new Date(),
      } });
      queuedEmailIds.push(id);
      return { type: action.type, status: "queued", template: action.template } as const;
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      return { type: action.type, status: "duplicate", template: action.template } as const;
    }
  }

  if (event.subjectType === "viewer_session") return { type: action.type, status: "recipient_not_linked" } as const;
  const buttonUrl = replaceArtifacts(action.buttonUrl, artifacts);
  const result = await enqueueLineNotification(db, {
    vendorId: event.vendorId,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    trigger: "automation",
    // Bind delivery deduplication to the durable execution claim. Watch
    // heartbeats have changing event ids, but a reclaimed execution must reuse
    // the same LINE outbox key.
    idempotencyKey: stableLineIdempotencyKey(["automation", executionLogId, actionIndex]),
    messages: [buildAutomationLineMessage({
      message: replaceArtifacts(action.message, artifacts) ?? action.message,
      buttonLabel: action.buttonLabel,
      buttonUrl,
    })],
  });
  return { type: action.type, status: result.status } as const;
}

/**
 * Claims each rule/event pair before running actions. A replay sees the unique
 * execution log and cannot issue a second voucher, tag, or LINE outbox row.
 *
 * Every email queued across all matched rules is handed to one post-response
 * hook, bounded by its shared per-call cap; the job sends anything beyond it.
 *
 * `db` must be the regular client, never an interactive transaction client.
 * A rule deleted mid-event is recovered from a caught foreign-key error (P2003)
 * or missing row (P2025) by issuing further queries; inside a PostgreSQL
 * transaction the failed statement would abort it and those queries would
 * fail too. Every caller today passes getDb().
 */
export async function dispatchAutomationEvent(db: AutomationDb, event: AutomationEvent) {
  const queuedEmailIds: string[] = [];
  try {
    return await runAutomationEvent(db, event, queuedEmailIds);
  } finally {
    // Rows already written stay queued even if a later rule fails.
    scheduleImmediateEmailDispatch(queuedEmailIds);
  }
}

type ActionArtifacts = { voucherUrl?: string; consultationUrl?: string; webinarUrl?: string };

/**
 * Runs a rule's (or a delayed step's) actions in their fixed order: vouchers
 * first, so the other actions can link to them, then a LINE follow-up for a
 * voucher when the actions have no LINE push of their own. Results are pushed
 * into `actionResults` as they finish, so a thrown action leaves the earlier
 * ones recorded. Every output has a deterministic id or idempotency key bound
 * to `logId`, so running the same execution again repeats nothing.
 */
async function runRuleActions(
  db: AutomationDb,
  rule: ParsedRule,
  event: AutomationEvent,
  logId: string,
  queuedEmailIds: string[],
  actionResults: unknown[],
  context: ActionContext,
) {
  const artifacts: ActionArtifacts = {
    consultationUrl: event.consultationUrl,
    webinarUrl: event.webinarUrl,
  };
  const orderedActions = rule.actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => Number(right.action.type === "issue_repurchase_voucher") - Number(left.action.type === "issue_repurchase_voucher"));
  for (const { action, index } of orderedActions) {
    actionResults.push(await executeAction(db, rule, event, logId, action, index, artifacts, queuedEmailIds, context));
  }
  if (artifacts.voucherUrl && !rule.actions.some((action) => action.type === "line_push") && event.subjectType !== "viewer_session") {
    const delivery = await enqueueLineNotification(db, {
      vendorId: event.vendorId,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      trigger: "automation",
      idempotencyKey: stableLineIdempotencyKey(["automation-voucher", logId]),
      messages: [buildAutomationLineMessage({
        message: "感謝支持，您的專屬回購折價券已經準備好了。",
        buttonLabel: "立即使用",
        buttonUrl: artifacts.voucherUrl,
      })],
    });
    actionResults.push({ type: "line_push", status: delivery.status, source: "voucher_delivery" });
  }
}

/** The first action result that reports its own failure (today only an automation e-mail without an unsubscribe link). */
function reportedActionFailure(actionResults: unknown[]) {
  return actionResults.find((result): result is { status: "failed"; reason: string } => (
    Boolean(result) && typeof result === "object" && (result as { status?: unknown }).status === "failed"
  ));
}

type StoredRule = {
  id: string;
  version: number;
  condition: unknown;
  actions: unknown;
  /** The rule's first active delayed step (absent on rows read without it). */
  steps?: Array<{ delayMinutes: number }>;
};

/**
 * Claims the rule/event pair: a new execution log, or a failed (or stale
 * running) one reclaimed for the same event. Any other existing log makes the
 * event a duplicate.
 */
async function claimRuleExecution(
  db: AutomationDb,
  rule: ParsedRule,
  event: AutomationEvent,
  firstStep: { delayMinutes: number } | undefined,
): Promise<{ log: { id: string; createdAt?: Date } } | { status: "rule_deleted" | "duplicate" }> {
  const idempotencyKey = executionIdempotencyKey(rule, event);
  try {
    const log = await db.automationExecutionLog.create({
      data: {
        vendorId: event.vendorId,
        ruleId: rule.id,
        idempotencyKey,
        eventId: event.eventId,
        liveId: event.liveId,
        trigger: event.trigger,
        subjectType: event.subjectType,
        subjectKeyHash: event.subjectKeyHash,
        status: "running",
      },
      select: { id: true, createdAt: true },
    });
    return { log };
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      // The rule was deleted after it was selected above (the delete holds
      // the rule row FOR UPDATE, so this insert waited and then lost its
      // parent). Confirm that, rather than assume it for every foreign key
      // of the log, and move on to the event's other rules.
      const stillThere = await db.automationRule.findFirst({ where: { id: rule.id, vendorId: event.vendorId }, select: { id: true } });
      if (stillThere) throw error;
      return { status: "rule_deleted" };
    }
    if (!isUniqueConflict(error)) throw error;
  }
  const existing = await db.automationExecutionLog.findUnique({
    where: { vendorId_idempotencyKey: { vendorId: event.vendorId, idempotencyKey } },
    select: { id: true, status: true, startedAt: true, createdAt: true, conditionMatched: true },
  });
  if (!existing || existing.status === "completed" || existing.status === "skipped") {
    // A replayed event: the delayed steps start at most once (the run's
    // unique key), but a first attempt that could not create the run gets
    // it now.
    if (existing?.status === "completed" && existing.conditionMatched && firstStep) {
      await startDelayedSteps(db, { ruleId: rule.id, event, logId: existing.id, anchorAt: existing.createdAt });
    }
    return { status: "duplicate" };
  }
  const now = new Date();
  const reclaimed = await db.automationExecutionLog.updateMany({
    where: {
      id: existing.id,
      vendorId: event.vendorId,
      OR: [
        { status: "failed" },
        { status: "running", startedAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
      ],
    },
    data: { status: "running", startedAt: now, completedAt: null, errorCode: null },
  });
  if (reclaimed.count !== 1) return { status: "duplicate" };
  return { log: { id: existing.id, createdAt: existing.createdAt } };
}

async function runAutomationEvent(db: AutomationDb, event: AutomationEvent, queuedEmailIds: string[]) {
  if ((event.trigger === "viewer_watch_progress" || event.trigger === "webinar_attended_duration_gte") && !event.liveId) {
    return [{ ruleId: "__scope__", status: "missing_live_scope" }];
  }
  const rules: StoredRule[] = await db.automationRule.findMany({
    where: {
      vendorId: event.vendorId,
      trigger: event.trigger,
      isActive: true,
      // An unscoped rule remains vendor-wide. A scoped rule can only run for
      // the exact trusted funnel page that emitted the event.
      OR: [{ funnelPageId: null }, ...(event.funnelPageId ? [{ funnelPageId: event.funnelPageId }] : [])],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      version: true,
      condition: true,
      actions: true,
      // F-4: whether the rule has delayed steps, and when the first one is due.
      steps: { where: { vendorId: event.vendorId, isActive: true }, orderBy: { delayMinutes: "asc" }, take: 1, select: { delayMinutes: true } },
    },
  });
  const results: Array<{ ruleId: string; status: string }> = [];

  for (const storedRule of rules) {
    const rule = parseAutomationRule(storedRule);
    if (!rule) {
      results.push({ ruleId: storedRule.id, status: "invalid_rule" });
      continue;
    }
    const firstStep = storedRule.steps?.[0];
    const matched = automationConditionMatches(rule.condition, event);
    if ((event.trigger === "viewer_watch_progress" || event.trigger === "webinar_attended_duration_gte") && !matched) {
      results.push({ ruleId: rule.id, status: "skipped" });
      continue;
    }
    const claim = await claimRuleExecution(db, rule, event, firstStep);
    if ("status" in claim) {
      results.push({ ruleId: rule.id, status: claim.status });
      continue;
    }
    const { log } = claim;

    if (!matched) {
      const recorded = await finishExecution(db, log.id, { status: "skipped", conditionMatched: false, completedAt: new Date() });
      results.push({ ruleId: rule.id, status: recorded ? "skipped" : "rule_deleted" });
      continue;
    }

    const actionResults: unknown[] = [];
    let status: "completed" | "failed" | "rule_deleted";
    try {
      await runRuleActions(db, rule, event, log.id, queuedEmailIds, actionResults, { emailTrigger: AUTOMATION_EMAIL_TRIGGER });
      // An action that reports its own failure (today only an automation
      // e-mail without an unsubscribe link) lets the other actions run, but
      // the execution is recorded as failed, like a thrown action, so the
      // same event can reclaim it. A reclaim repeats every action safely: the
      // tag is an upsert, the voucher, LINE and e-mail rows have
      // deterministic ids or idempotency keys.
      const reportedFailure = reportedActionFailure(actionResults);
      const recorded = await finishExecution(db, log.id, {
        status: reportedFailure ? "failed" : "completed",
        conditionMatched: true,
        actionResults: actionResults as Prisma.InputJsonArray,
        ...(reportedFailure ? { errorCode: reportedFailure.reason } : {}),
        completedAt: new Date(),
      });
      status = !recorded ? "rule_deleted" : reportedFailure ? "failed" : "completed";
    } catch {
      // A thrown action ends this rule only (as before). When the rule was
      // deleted meanwhile (e.g. a tag whose sourceExecutionLogId no longer
      // exists), the failed-state write finds no log row either; that is the
      // P2025 finishExecution absorbs, and the event's other rules still run.
      const recorded = await finishExecution(db, log.id, {
        status: "failed",
        conditionMatched: true,
        actionResults: actionResults as Prisma.InputJsonArray,
        errorCode: "action_failed",
        completedAt: new Date(),
      });
      status = recorded ? "failed" : "rule_deleted";
    }
    // F-4: the rule's delayed steps start after its immediate actions,
    // whatever they did (the steps re-check everything when they are due).
    // Never fails the event: see startDelayedSteps.
    if (status !== "rule_deleted" && firstStep) {
      await startDelayedSteps(db, { ruleId: rule.id, event, logId: log.id, anchorAt: log.createdAt });
    }
    results.push({ ruleId: rule.id, status });
  }
  return results;
}

/**
 * F-4 (docs/product/delayed-steps-design.md §8): one DelayedStepRun per rule
 * and triggering event, anchored at the event's first execution, due when the
 * rule's first active step is. Only for a trigger merchants may use today and
 * whose subject the worker can read again later: the registration of
 * `form_registered`, the booking of the two consultation triggers. The run
 * stores references only (rule, execution log, subject, customer key), never
 * the event's e-mail address.
 *
 * Best effort and idempotent: the unique (vendorId, automationRuleId,
 * sourceExecutionLogId) makes a replay a no-op, and any error is reported and
 * swallowed, so the immediate actions already done and the registration or
 * booking request are never affected.
 */
async function startDelayedSteps(
  db: AutomationDb,
  input: { ruleId: string; event: AutomationEvent; logId: string; anchorAt: Date | undefined },
) {
  const { event } = input;
  try {
    if (!isAvailableAutomationTrigger(event.trigger) || event.subjectType !== "buyer_registration" || !event.subjectKeyHash) return;
    // Closed beta (M3): only a vendor holding the grant, and not suspended.
    const vendor = await db.vendor.findUnique({ where: { id: event.vendorId }, select: { betaFeatureGrants: true, suspendedAt: true } });
    if (!vendor || vendor.suspendedAt || !isFeatureEnabled(vendor, AUTOMATION_DELAYED_STEPS_FEATURE)) return;
    const subject = event.trigger === "form_registered"
      // FormSubmission has no vendorId: the registration is bound through its form.
      ? await db.formSubmission.findFirst({ where: { id: event.subjectId, form: { vendorId: event.vendorId } }, select: { id: true } })
        .then((row) => row ? { formSubmissionId: row.id } : null)
      : await db.consultationBooking.findFirst({ where: { id: event.subjectId, vendorId: event.vendorId }, select: { id: true } })
        .then((row) => row ? { consultationBookingId: row.id } : null);
    if (!subject) return;
    const anchorAt = input.anchorAt ?? new Date();
    const subjectKeyHash = event.subjectKeyHash;
    // m1: the first due time comes from the steps as they are now, read after
    // the rule row FOR SHARE. A merchant saving steps holds that row FOR UPDATE
    // (automation-delayed-steps.ts), and switching the rule off does too, so
    // this run either waits for the save and uses its steps, or the save
    // re-times this run after it. A rule switched off meanwhile gets no run.
    await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "AutomationRule"
        WHERE "id" = ${input.ruleId} AND "vendorId" = ${event.vendorId} AND "isActive"
        FOR SHARE
      `;
      if (locked.length === 0) return;
      const first = await tx.automationRuleStep.findFirst({
        where: { vendorId: event.vendorId, ruleId: input.ruleId, isActive: true },
        orderBy: { delayMinutes: "asc" },
        select: { delayMinutes: true },
      });
      if (!first) return;
      await tx.delayedStepRun.createMany({
        data: [{
          vendorId: event.vendorId,
          automationRuleId: input.ruleId,
          sourceExecutionLogId: input.logId,
          ...subject,
          subjectKeyHash,
          anchorAt,
          cursorDelayMinutes: -1,
          status: "active",
          nextRunAt: new Date(anchorAt.getTime() + first.delayMinutes * 60_000),
        }],
        skipDuplicates: true,
      });
    });
  } catch (error) {
    // A rule deleted in between (its log cascades with it) is simply over.
    if (isForeignKeyViolation(error)) return;
    try {
      captureOperationalError(error, { area: "automation_delayed_steps", operation: "start_run", vendorId: event.vendorId });
    } catch {
      // Monitoring must never change the event's outcome.
    }
  }
}

export type AutomationStepOutcome = {
  status: "completed" | "skipped" | "already_done" | "invalid_step" | "rule_deleted" | "failed";
  /** E-mails this execution queued (AUTOMATION_STEP_EMAIL_TRIGGER), for the worker's send quota. */
  emailsQueued: number;
};

/** Deterministic id of one delayed step's execution log: a reclaimed step reuses it, so every action id derived from it repeats. */
export function automationStepExecutionLogId(vendorId: string, runId: string, stepId: string) {
  return `aes_${createHash("sha256").update(`automation-step:v1:${vendorId}:${runId}:${stepId}`).digest("hex").slice(0, 28)}`;
}

function automationStepIdempotencyKey(input: { vendorId: string; ruleId: string; runId: string; stepId: string }) {
  return createHash("sha256").update(`automation-step:v1:${input.vendorId}:${input.ruleId}:${input.runId}:${input.stepId}`).digest("hex");
}

/**
 * Executes one due delayed step for the worker (src/lib/automation-delayed-
 * steps.ts), which holds the run's lease and rebuilt `event` from the run's
 * stored references (recipient read again, never from the original event).
 *
 * One AutomationExecutionLog per run and step: its id and idempotency key are
 * both derived from (vendor, run, step), so a lease that expired and was
 * claimed again finds the same log. A completed or skipped log means the step
 * is done (`already_done`, nothing runs again); a running or failed one is
 * resumed, and every action id, LINE key and voucher bearer derived from the
 * log id repeats, so nothing is sent or issued twice. The step's condition is
 * evaluated against `event` now. E-mails are queued with
 * AUTOMATION_STEP_EMAIL_TRIGGER and are not dispatched here: the job sends
 * them on the sequence quota.
 */
export async function executeAutomationStep(
  db: AutomationDb,
  input: { ruleId: string; runId: string; stepId: string; condition: unknown; actions: unknown; event: AutomationEvent },
): Promise<AutomationStepOutcome> {
  const { event } = input;
  let rule = parseAutomationRule({ id: input.ruleId, condition: input.condition, actions: input.actions });
  if (!rule) return { status: "invalid_step", emailsQueued: 0 };
  const logId = automationStepExecutionLogId(event.vendorId, input.runId, input.stepId);
  const idempotencyKey = automationStepIdempotencyKey({ vendorId: event.vendorId, ruleId: input.ruleId, runId: input.runId, stepId: input.stepId });
  try {
    await db.automationExecutionLog.create({
      data: {
        id: logId,
        vendorId: event.vendorId,
        ruleId: input.ruleId,
        idempotencyKey,
        eventId: automationStepEventId(input.runId, input.stepId),
        trigger: event.trigger,
        subjectType: event.subjectType,
        subjectKeyHash: event.subjectKeyHash,
        status: "running",
        // m2: the actions this execution runs, kept for a resume.
        actionResults: stepActionResults(rule.actions, []),
      },
      select: { id: true },
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) return { status: "rule_deleted", emailsQueued: 0 };
    if (!isUniqueConflict(error)) throw error;
    const existing = await db.automationExecutionLog.findUnique({
      where: { vendorId_idempotencyKey: { vendorId: event.vendorId, idempotencyKey } },
      select: { id: true, status: true, actionResults: true },
    });
    if (!existing || existing.id !== logId) throw new Error("Delayed step execution log does not match its deterministic id.");
    if (existing.status === "completed" || existing.status === "skipped") return { status: "already_done", emailsQueued: 0 };
    const resumed = await db.automationExecutionLog.updateMany({
      where: { id: logId, vendorId: event.vendorId, status: { in: ["running", "failed"] } },
      data: { status: "running", startedAt: new Date(), completedAt: null, errorCode: null },
    });
    if (resumed.count !== 1) return { status: "already_done", emailsQueued: 0 };
    // m2: a resumed execution runs the actions it started with, even if the
    // merchant edited the step since. Every voucher id, LINE key and e-mail id
    // is derived from (log id, action index), so the same list keeps them
    // pointing at the same outputs.
    const snapshot = parseAutomationRule({ id: input.ruleId, condition: rule.condition, actions: stepActionSnapshot(existing.actionResults) });
    if (snapshot) rule = snapshot;
  }
  const runningRule = rule;

  if (!automationConditionMatches(rule.condition, event)) {
    const recorded = await finishExecution(db, logId, { status: "skipped", conditionMatched: false, completedAt: new Date() });
    return { status: recorded ? "skipped" : "rule_deleted", emailsQueued: 0 };
  }

  const actionResults: unknown[] = [];
  const queuedEmailIds: string[] = [];
  try {
    await runRuleActions(db, runningRule, event, logId, queuedEmailIds, actionResults, { emailTrigger: AUTOMATION_STEP_EMAIL_TRIGGER });
  } catch {
    const recorded = await finishExecution(db, logId, {
      status: "failed",
      conditionMatched: true,
      actionResults: stepActionResults(runningRule.actions, actionResults),
      errorCode: "action_failed",
      completedAt: new Date(),
    });
    return { status: recorded ? "failed" : "rule_deleted", emailsQueued: queuedEmailIds.length };
  }
  const reportedFailure = reportedActionFailure(actionResults);
  const recorded = await finishExecution(db, logId, {
    status: reportedFailure ? "failed" : "completed",
    conditionMatched: true,
    actionResults: stepActionResults(runningRule.actions, actionResults),
    ...(reportedFailure ? { errorCode: reportedFailure.reason } : {}),
    completedAt: new Date(),
  });
  return { status: !recorded ? "rule_deleted" : reportedFailure ? "failed" : "completed", emailsQueued: queuedEmailIds.length };
}

/**
 * `actionResults` of a delayed step's execution log: the actions it runs
 * (its snapshot, m2) and their results. Immediate executions keep the plain
 * results array.
 */
function stepActionResults(actions: AutomationAction[], results: unknown[]): Prisma.InputJsonObject {
  return { actions: actions as Prisma.InputJsonArray, results: results as Prisma.InputJsonArray };
}

function stepActionSnapshot(actionResults: unknown) {
  return actionResults && typeof actionResults === "object" && !Array.isArray(actionResults)
    ? (actionResults as { actions?: unknown }).actions
    : undefined;
}

const AUTOMATION_STEP_EVENT_PREFIX = "delayed-step:";

/** `AutomationExecutionLog.eventId` of a delayed step's execution. */
export function automationStepEventId(runId: string, stepId: string) {
  return `${AUTOMATION_STEP_EVENT_PREFIX}${runId}:${stepId}`;
}

/** Whether an execution log belongs to a delayed step (shown as such in the back office). */
export function isAutomationStepExecution(log: { eventId: string }) {
  return log.eventId.startsWith(AUTOMATION_STEP_EVENT_PREFIX);
}

/**
 * Runs once when a live transitions to ended. Attendance is proven by a
 * completed watch automation log; registrations without that proof receive
 * the tenant-scoped no-show event. Pagination prevents an unbounded query.
 */
export async function dispatchFormNoShowAutomationsForLive(
  db: Pick<PrismaClient, "live" | "formSubmission" | "commerceOrder"> & AutomationDb,
  input: { vendorId: string; liveId: string },
) {
  const live = await db.live.findFirst({ where: { id: input.liveId, vendorId: input.vendorId, status: "ended" }, select: { id: true, slug: true } });
  if (!live) return { dispatched: 0 };
  let cursor: string | undefined;
  let dispatched = 0;
  do {
    const submissions = await db.formSubmission.findMany({
      where: { liveId: live.id, verificationStatus: "VERIFIED", form: { vendorId: input.vendorId } },
      orderBy: { id: "asc" },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, email: true },
    });
    for (const submission of submissions) {
      const subjectKeyHash = automationCustomerKeyHash(input.vendorId, submission.email);
      const attended = await db.automationExecutionLog.findFirst({
        where: { vendorId: input.vendorId, liveId: live.id, trigger: { in: ["viewer_watch_progress", "webinar_attended_duration_gte"] }, subjectKeyHash, conditionMatched: true, status: "completed" },
        select: { id: true },
      });
      if (!attended) {
        await dispatchAutomationEvent(db, {
          vendorId: input.vendorId,
          eventId: `form-no-show:${live.id}:${submission.id}`,
          trigger: "form_no_show",
          subjectType: "buyer_registration",
          subjectId: submission.id,
          subjectKeyHash,
          liveId: live.id,
          recipientEmail: submission.email,
          webinarUrl: new URL(`/live/${encodeURIComponent(live.slug)}`, getCanonicalAppUrl()).toString(),
        });
        dispatched += 1;
      }
    }
    cursor = submissions.length === 200 ? submissions.at(-1)?.id : undefined;
  } while (cursor);
  return { dispatched };
}

export async function dispatchPaymentPaidAutomation(input: {
  vendorId: string;
  webhookEventId: string;
  transactionId: string;
}) {
  const db = getDb();
  const order = await db.commerceOrder.findFirst({
    where: { vendorId: input.vendorId, primaryPaymentTransactionId: input.transactionId, status: "paid" },
    select: { id: true, totalAmountCents: true, currency: true, checkoutIdentityHash: true, automationCustomerKeyHash: true },
  });
  if (!order) return [];
  const results = await dispatchAutomationEvent(db, {
    vendorId: input.vendorId,
    eventId: input.webhookEventId,
    trigger: "payment_paid",
    subjectType: "buyer_order",
    subjectId: order.id,
    subjectKeyHash: order.automationCustomerKeyHash ?? order.checkoutIdentityHash,
    orderAmountCents: order.totalAmountCents,
    currency: order.currency,
  });
  if (results.some((result) => result.status === "failed")) throw new Error("Payment automation action failed.");
  return results;
}

/** Recovers a post-commit automation dispatch from a repeated provider callback. */
export async function dispatchPaymentPaidAutomationByOrder(input: {
  webhookEventId: string;
  providerName: string;
  orderNumber: string;
  vendorId?: string;
}) {
  const db = getDb();
  const transactions = await db.paymentTransaction.findMany({
    where: {
      providerName: input.providerName,
      orderNumber: input.orderNumber,
      status: "paid",
      ...(input.vendorId ? { vendorId: input.vendorId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { id: true, vendorId: true },
  });
  if (transactions.length !== 1 || !transactions[0]) throw new Error("Automation payment source is ambiguous.");
  return dispatchPaymentPaidAutomation({
    vendorId: transactions[0].vendorId,
    webhookEventId: input.webhookEventId,
    transactionId: transactions[0].id,
  });
}
