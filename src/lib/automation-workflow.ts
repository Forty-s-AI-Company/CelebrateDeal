import { createHash, createHmac } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db";
import { hashInteractionBearer } from "@/lib/live-interaction";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";
import {
  buildAutomationLineMessage,
  enqueueLineNotification,
  stableLineIdempotencyKey,
} from "@/lib/line-notification";

export const AUTOMATION_TRIGGERS = ["payment_paid", "viewer_watch_progress"] as const;
export type AutomationTrigger = typeof AUTOMATION_TRIGGERS[number];

const AutomationConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("always") }).strict(),
  z.object({ type: z.literal("order_amount_gte"), amountCents: z.number().int().min(1) }).strict(),
  z.object({ type: z.literal("watch_seconds_gte"), seconds: z.number().int().min(1).max(86_400) }).strict(),
]);

function isSafeAutomationButtonUrl(value: string | null | undefined) {
  if (!value || value === "{{voucher_url}}") return true;
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
]).refine((action) => action.type !== "issue_repurchase_voucher" || action.discountType !== "percentage" || action.discountValue <= 99, {
  message: "Percentage vouchers must remain below 100%.",
}).refine((action) => action.type !== "line_push" || isSafeAutomationButtonUrl(action.buttonUrl), {
  message: "LINE button URL must be HTTP(S) or use the voucher placeholder.",
});

export type AutomationCondition = z.infer<typeof AutomationConditionSchema>;
export type AutomationAction = z.infer<typeof AutomationActionSchema>;

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
};

type AutomationDb = Pick<
  PrismaClient,
  "automationRule" | "automationExecutionLog" | "automationVoucherGrant" | "customerTagAssignment" | "product" | "lineOfficialAccount" | "lineUserIdentity" | "lineDelivery"
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
  return event.trigger === "viewer_watch_progress" && (event.watchSecondsTotal ?? -1) >= condition.seconds;
}

function executionIdempotencyKey(rule: ParsedRule, event: AutomationEvent) {
  const eventIdentity = event.trigger === "viewer_watch_progress"
    ? `subject:${event.subjectKeyHash}:version:${rule.version}`
    : `event:${event.eventId}`;
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

function replaceArtifacts(value: string | null | undefined, artifacts: { voucherUrl?: string }) {
  if (!value) return value ?? null;
  return value.replaceAll("{{voucher_url}}", artifacts.voucherUrl ?? "");
}

async function executeAction(
  db: AutomationDb,
  rule: ParsedRule,
  event: AutomationEvent,
  executionLogId: string,
  action: AutomationAction,
  actionIndex: number,
  artifacts: { voucherUrl?: string },
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
    if (event.trigger === "viewer_watch_progress" && !matched) {
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
    const artifacts: { voucherUrl?: string } = {};
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

export async function dispatchPaymentPaidAutomation(input: {
  vendorId: string;
  webhookEventId: string;
  transactionId: string;
}) {
  const db = getDb();
  const order = await db.commerceOrder.findFirst({
    where: { vendorId: input.vendorId, primaryPaymentTransactionId: input.transactionId, status: "paid" },
    select: { id: true, totalAmountCents: true, currency: true, checkoutIdentityHash: true },
  });
  if (!order) return [];
  const results = await dispatchAutomationEvent(db, {
    vendorId: input.vendorId,
    eventId: input.webhookEventId,
    trigger: "payment_paid",
    subjectType: "buyer_order",
    subjectId: order.id,
    subjectKeyHash: order.checkoutIdentityHash,
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
