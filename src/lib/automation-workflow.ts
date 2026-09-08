import { createHash, createHmac } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db";
import { hashInteractionBearer } from "@/lib/live-interaction";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";
import { protectEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import {
  buildAutomationLineMessage,
  enqueueLineNotification,
  stableLineIdempotencyKey,
} from "@/lib/line-notification";

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

export function automationCustomerKeyHash(vendorId: string, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!vendorId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) throw new Error("Invalid automation customer identity.");
  return createHmac("sha256", deriveSensitiveDataKey("automation-customer-key-v1"))
    .update(`${vendorId}\n${normalized}`)
    .digest("base64url");
}

const AutomationConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("always") }).strict(),
  z.object({ type: z.literal("order_amount_gte"), amountCents: z.number().int().min(1) }).strict(),
  z.object({ type: z.literal("watch_seconds_gte"), seconds: z.number().int().min(1).max(86_400) }).strict(),
  z.object({ type: z.literal("watch_seconds_gte_and_not_purchased"), seconds: z.number().int().min(1).max(86_400) }).strict(),
]);

const AUTOMATION_URL_PLACEHOLDERS = new Set(["{{voucher_url}}", "{{consultation_url}}", "{{webinar_url}}"]);

function isSafeAutomationButtonUrl(value: string | null | undefined) {
  if (!value || AUTOMATION_URL_PLACEHOLDERS.has(value)) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

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

export type AutomationEvent = {
  vendorId: string;
  eventId: string;
  trigger: AutomationTrigger;
  subjectType: "buyer_order" | "buyer_registration" | "viewer_session";
  subjectId: string;
  subjectKeyHash: string;
  orderAmountCents?: number;
  currency?: string;
  watchSecondsTotal?: number;
  hasPurchased?: boolean;
  recipientEmail?: string;
  consultationUrl?: string;
  webinarUrl?: string;
};

type AutomationDb = Pick<
  PrismaClient,
  "automationRule" | "automationExecutionLog" | "automationVoucherGrant" | "customerTagAssignment" | "product" | "lineOfficialAccount" | "lineUserIdentity" | "lineDelivery" | "emailDelivery"
>;

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
    ? `viewer:${event.subjectKeyHash}:version:${rule.version}`
    : `order:${event.subjectId}:version:${rule.version}`;
  return createHash("sha256").update(`automation:v1:${event.vendorId}:${rule.id}:${event.trigger}:${eventIdentity}`).digest("hex");
}

function deterministicActionId(executionLogId: string, actionIndex: number) {
  return `aut_${createHash("sha256").update(`${executionLogId}:${actionIndex}`).digest("hex").slice(0, 28)}`;
}

function deterministicVoucherBearer(executionLogId: string, actionIndex: number) {
  return createHmac("sha256", deriveSensitiveDataKey("automation-voucher-bearer-v1"))
    .update(`${executionLogId}:${actionIndex}`)
    .digest("base64url");
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
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

async function executeAction(
  db: AutomationDb,
  rule: ParsedRule,
  event: AutomationEvent,
  executionLogId: string,
  action: AutomationAction,
  actionIndex: number,
  artifacts: { voucherUrl?: string; consultationUrl?: string; webinarUrl?: string },
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
      const voucherUrl = new URL("/api/automation/vouchers/redeem", getCanonicalAppUrl());
      voucherUrl.searchParams.set("token", bearer);
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
    const id = deterministicActionId(executionLogId, actionIndex);
    const copy = EMAIL_COPY[action.template];
    const protectedPayload = protectEmailDeliveryPayload({
      recipientEmail: event.recipientEmail,
      subject: copy.subject,
      body: replaceArtifacts(copy.body, artifacts) ?? copy.body,
    }, { vendorId: event.vendorId, deliveryId: id });
    try {
      await db.emailDelivery.create({ data: {
        id,
        vendorId: event.vendorId,
        sourceTemplateId: `automation_${action.template}_v1`,
        trigger: "automation",
        ...protectedPayload,
        idempotencyKey: stableLineIdempotencyKey(["automation-email", executionLogId, actionIndex]),
        status: "queued",
        nextAttemptAt: new Date(),
      } });
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
 */
export async function dispatchAutomationEvent(db: AutomationDb, event: AutomationEvent) {
  const rules = await db.automationRule.findMany({
    where: { vendorId: event.vendorId, trigger: event.trigger, isActive: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, version: true, condition: true, actions: true },
  });
  const results: Array<{ ruleId: string; status: string }> = [];

  for (const storedRule of rules) {
    const rule = parseAutomationRule(storedRule);
    if (!rule) {
      results.push({ ruleId: storedRule.id, status: "invalid_rule" });
      continue;
    }
    const matched = automationConditionMatches(rule.condition, event);
    if ((event.trigger === "viewer_watch_progress" || event.trigger === "webinar_attended_duration_gte") && !matched) {
      results.push({ ruleId: rule.id, status: "skipped" });
      continue;
    }
    const idempotencyKey = executionIdempotencyKey(rule, event);
    let log: { id: string };
    try {
      log = await db.automationExecutionLog.create({
        data: {
          vendorId: event.vendorId,
          ruleId: rule.id,
          idempotencyKey,
          eventId: event.eventId,
          trigger: event.trigger,
          subjectType: event.subjectType,
          subjectKeyHash: event.subjectKeyHash,
          status: "running",
        },
        select: { id: true },
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const existing = await db.automationExecutionLog.findUnique({
        where: { vendorId_idempotencyKey: { vendorId: event.vendorId, idempotencyKey } },
        select: { id: true, status: true, startedAt: true },
      });
      if (!existing || existing.status === "completed" || existing.status === "skipped") {
        results.push({ ruleId: rule.id, status: "duplicate" });
        continue;
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
      if (reclaimed.count !== 1) {
        results.push({ ruleId: rule.id, status: "duplicate" });
        continue;
      }
      log = { id: existing.id };
    }

    if (!matched) {
      await db.automationExecutionLog.update({
        where: { id: log.id },
        data: { status: "skipped", conditionMatched: false, completedAt: new Date() },
      });
      results.push({ ruleId: rule.id, status: "skipped" });
      continue;
    }

    const actionResults: unknown[] = [];
    const artifacts: { voucherUrl?: string; consultationUrl?: string; webinarUrl?: string } = {
      consultationUrl: event.consultationUrl,
      webinarUrl: event.webinarUrl,
    };
    try {
      const orderedActions = rule.actions
        .map((action, index) => ({ action, index }))
        .sort((left, right) => Number(right.action.type === "issue_repurchase_voucher") - Number(left.action.type === "issue_repurchase_voucher"));
      for (const { action, index } of orderedActions) {
        actionResults.push(await executeAction(db, rule, event, log.id, action, index, artifacts));
      }
      if (artifacts.voucherUrl && !rule.actions.some((action) => action.type === "line_push") && event.subjectType !== "viewer_session") {
        const delivery = await enqueueLineNotification(db, {
          vendorId: event.vendorId,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          trigger: "automation",
          idempotencyKey: stableLineIdempotencyKey(["automation-voucher", log.id]),
          messages: [buildAutomationLineMessage({
            message: "感謝支持，您的專屬回購折價券已經準備好了。",
            buttonLabel: "立即使用",
            buttonUrl: artifacts.voucherUrl,
          })],
        });
        actionResults.push({ type: "line_push", status: delivery.status, source: "voucher_delivery" });
      }
      await db.automationExecutionLog.update({
        where: { id: log.id },
        data: {
          status: "completed",
          conditionMatched: true,
          actionResults: actionResults as Prisma.InputJsonArray,
          completedAt: new Date(),
        },
      });
      results.push({ ruleId: rule.id, status: "completed" });
    } catch {
      await db.automationExecutionLog.update({
        where: { id: log.id },
        data: {
          status: "failed",
          conditionMatched: true,
          actionResults: actionResults as Prisma.InputJsonArray,
          errorCode: "action_failed",
          completedAt: new Date(),
        },
      });
      results.push({ ruleId: rule.id, status: "failed" });
    }
  }
  return results;
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
        where: { vendorId: input.vendorId, trigger: { in: ["viewer_watch_progress", "webinar_attended_duration_gte"] }, subjectKeyHash, conditionMatched: true, status: "completed" },
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
