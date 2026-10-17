import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { getDb } from "@/lib/db";
import { LineFetchClient, LineMessagingError, type LineFlexContents, type LineMessage, type LineMessagingClient } from "@/lib/line-client";
import { unprotectLineOfficialAccountCredentials, unprotectLineProfileValue } from "@/lib/line-credentials";
import { decryptSensitiveValue, encryptSensitiveValue } from "@/lib/sensitive-data";
import { LINE_WEBINAR_TEMPLATE_TRIGGERS } from "@/lib/message-template";
import { buildLineWebinarMessages, findLineWebinarTemplate, lineWebinarTemplateFingerprint, type LineWebinarVariables } from "@/lib/line-webinar-template";
import { resolveSubjectLineAccount, type LineAccountRoutingDatabase } from "@/lib/line-account-routing";

export const LINE_NOTIFICATION_TRIGGERS = [
  "registration_confirmed",
  "live_reminder",
  "live_started",
  "order_created",
  "order_paid",
  "commission_credited",
  "automation",
] as const;
export type LineNotificationTrigger = typeof LINE_NOTIFICATION_TRIGGERS[number];

type LineNotificationDatabase = LineAccountRoutingDatabase & Pick<PrismaClient, "lineUserIdentity" | "lineDelivery">;
type LineWebinarDeliveryDatabase = LineNotificationDatabase & Pick<PrismaClient, "$transaction" | "messageTemplate" | "formSubmission">;
type LineClientFactory = (accessToken: string) => LineMessagingClient;
export type LineDeliveryProcessingScope = {
  /** Limits a worker invocation to one tenant without changing global cron behavior. */
  vendorId?: string;
  /** Limits a worker invocation to explicitly materialized delivery rows. */
  deliveryIds?: readonly string[];
};
const DELIVERY_LEASE_MS = 5 * 60_000;

const money = new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 });

function textComponent(text: string, weight: "regular" | "bold" = "regular") {
  return { type: "text", text, wrap: true, weight, color: "#1f2937" };
}
function actionButton(label: string, uri: string) {
  const url = new URL(uri);
  if (url.protocol !== "https:") throw new Error("Invalid LINE action URL.");
  return { type: "button", style: "primary", color: "#16a34a", action: { type: "uri", label: label.slice(0, 40), uri: url.toString() } };
}

function bubble(title: string, lines: string[], button?: ReturnType<typeof actionButton>): LineFlexContents {
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [textComponent(title, "bold"), ...lines.map((line) => textComponent(line))],
    },
    ...(button ? { footer: { type: "box", layout: "vertical", contents: [button] } } : {}),
  };
}

export function buildLiveLineMessage(input: {
  kind: "reminder" | "started";
  liveTitle: string;
  startsAtText: string;
  viewerUrl: string;
}): LineMessage {
  const title = input.kind === "started" ? "直播已經開始" : "直播預約提醒";
  return {
    type: "flex",
    altText: `${title}｜${input.liveTitle}`.slice(0, 400),
    contents: bubble(title, [input.liveTitle.slice(0, 500), `時間：${input.startsAtText}`], actionButton("立即進場", input.viewerUrl)),
  };
}

export function buildOrderLineMessage(input: {
  kind: "created" | "paid";
  orderNumber: string;
  amountCents: number;
  currency: string;
  orderUrl: string;
}): LineMessage {
  const title = input.kind === "paid" ? "付款成功電子收據" : "訂單成立";
  const amountText = input.currency === "TWD" ? money.format(input.amountCents / 100) : `${input.currency} ${(input.amountCents / 100).toFixed(2)}`;
  return {
    type: "flex",
    altText: `${title}｜${input.orderNumber}`.slice(0, 400),
    contents: bubble(title, [`訂單編號：${input.orderNumber}`, `金額：${amountText}`], actionButton("查看訂單", input.orderUrl)),
  };
}

export function buildCommissionLineMessage(input: {
  amountCents: number;
  currency: string;
  orderNumber: string | null;
}): LineMessage {
  const amountText = input.currency === "TWD" ? money.format(input.amountCents / 100) : `${input.currency} ${(input.amountCents / 100).toFixed(2)}`;
  return {
    type: "text",
    text: [`佣金已入帳：${amountText}`, input.orderNumber ? `來源訂單：${input.orderNumber}` : null]
      .filter(Boolean)
      .join("\n"),
  };
}

/** Builds merchant-authored automation copy without allowing arbitrary LINE payloads. */
export function buildAutomationLineMessage(input: {
  message: string;
  buttonLabel?: string | null;
  buttonUrl?: string | null;
}): LineMessage {
  const message = input.message.trim().slice(0, 1_500);
  if (!message) throw new Error("Automation LINE message is required.");
  if (!input.buttonLabel || !input.buttonUrl) return { type: "text", text: message };
  return {
    type: "flex",
    altText: message.slice(0, 400),
    contents: bubble("商家專屬通知", [message], actionButton(input.buttonLabel, input.buttonUrl)),
  };
}

function deliveryPurpose(vendorId: string, deliveryId: string) {
  return `line-delivery:${vendorId}:${deliveryId}`;
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Materializes an encrypted, tenant-idempotent LINE outbox entry. */
export async function enqueueLineNotification(
  db: LineNotificationDatabase & Partial<Pick<PrismaClient, "messageTemplate">>,
  input: {
    vendorId: string;
    subjectType: "user" | "promoter" | "buyer_order" | "buyer_registration";
    subjectId: string;
    trigger: LineNotificationTrigger;
    idempotencyKey: string;
    messages: readonly LineMessage[];
    dueAt?: Date;
    sourceTemplateId?: string | null;
    templateVariables?: LineWebinarVariables;
    requireTemplate?: boolean;
    eventOccurredAt?: Date;
  },
) {
  if (!LINE_NOTIFICATION_TRIGGERS.includes(input.trigger) || !input.idempotencyKey || input.idempotencyKey.length > 255) {
    throw new Error("Invalid LINE notification.");
  }
  const account = await resolveSubjectLineAccount(db, input.vendorId, input.subjectType, input.subjectId);
  if (!account || account.status !== "active") return { status: "not_linked" as const };
  const identity = await db.lineUserIdentity.findUnique({
      where: { vendorId_lineOfficialAccountId_subjectType_subjectId: { vendorId: input.vendorId, lineOfficialAccountId: account.id, subjectType: input.subjectType, subjectId: input.subjectId } },
      select: { id: true, revokedAt: true },
    });
  if (!identity || identity.revokedAt) return { status: "not_linked" as const };
  let messages = input.messages;
  let sourceTemplateId = input.sourceTemplateId ?? null;
  let templateFingerprint: string | null = null;
  if (input.requireTemplate && (!input.templateVariables || !(LINE_WEBINAR_TEMPLATE_TRIGGERS as readonly string[]).includes(input.trigger))) throw new Error("LINE template context is required.");
  if (input.templateVariables && (LINE_WEBINAR_TEMPLATE_TRIGGERS as readonly string[]).includes(input.trigger)) {
    if (!db.messageTemplate) throw new Error("LINE webinar template storage is required.");
    const template = await findLineWebinarTemplate({ messageTemplate: db.messageTemplate }, input.vendorId, input.trigger);
    if (!template && input.requireTemplate) return { status: "not_configured" as const };
    if (template) {
      if (input.trigger === "registration_confirmed" && (!input.eventOccurredAt || input.eventOccurredAt < template.updatedAt)) return { status: "event_precedes_template" as const };
      const rendered = buildLineWebinarMessages(template, input.templateVariables);
      if (!rendered) return { status: "template_disabled_or_invalid" as const };
      messages = rendered;sourceTemplateId = template.id;templateFingerprint = lineWebinarTemplateFingerprint(template);
    }
  }
  if (messages.length < 1 || messages.length > 5) throw new Error("Invalid LINE message count.");
  const id = randomUUID();
  const payloadEncrypted = encryptSensitiveValue(JSON.stringify(templateFingerprint ? { v: 2, templateFingerprint, messages } : messages), deliveryPurpose(input.vendorId, id));
  try {
    const delivery = await db.lineDelivery.create({
      data: {
        id,
        vendorId: input.vendorId,
        lineOfficialAccountId: account.id,
        lineUserIdentityId: identity.id,
        sourceTemplateId,
        trigger: input.trigger,
        idempotencyKey: input.idempotencyKey,
        payloadEncrypted,
        status: "queued",
        nextAttemptAt: input.dueAt ?? new Date(),
      },
      select: { id: true },
    });
    return { status: "queued" as const, deliveryId: delivery.id };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const existing = await db.lineDelivery.findUnique({
      where: { vendorId_lineOfficialAccountId_idempotencyKey: { vendorId: input.vendorId, lineOfficialAccountId: account.id, idempotencyKey: input.idempotencyKey } },
      select: { id: true },
    });
    return { status: "duplicate" as const, deliveryId: existing?.id ?? null };
  }
}

function safePayload(value: string): { messages: LineMessage[]; templateFingerprint: string | null } {
  const parsed: unknown = JSON.parse(value);
  if (Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= 5) return { messages: parsed as LineMessage[], templateFingerprint: null };
  if (parsed && typeof parsed === "object" && "v" in parsed && parsed.v === 2 && "templateFingerprint" in parsed && typeof parsed.templateFingerprint === "string" && /^[a-f0-9]{64}$/u.test(parsed.templateFingerprint) && "messages" in parsed && Array.isArray(parsed.messages) && parsed.messages.length >= 1 && parsed.messages.length <= 5) {
    return { messages: parsed.messages as LineMessage[], templateFingerprint: parsed.templateFingerprint };
  }
  throw new Error("Invalid LINE delivery payload.");
}

type CurrentLineDelivery = Prisma.LineDeliveryGetPayload<{ include: { identity: true } }>;
type DeliveryWithAccount = Prisma.LineDeliveryGetPayload<{include:{account:true;identity:true}}>;
function hasDeliveryConsent(current:DeliveryWithAccount|null):current is DeliveryWithAccount {
  return Boolean(current && current.vendorId === current.account.vendorId && current.vendorId === current.identity.vendorId && current.lineOfficialAccountId === current.identity.lineOfficialAccountId && current.account.status === "active" && !current.identity.revokedAt);
}

async function checkWebinarDeliverySource(db: LineWebinarDeliveryDatabase, current: CurrentLineDelivery, fingerprint: string | null, now: Date) {
  if (!(LINE_WEBINAR_TEMPLATE_TRIGGERS as readonly string[]).includes(current.trigger)) return null;
  const registration = current.identity.subjectType === "buyer_registration" ? await db.formSubmission.findFirst({
    where: { id: current.identity.subjectId, verificationStatus: "VERIFIED", form: { vendorId: current.vendorId }, live: { vendorId: current.vendorId } },
    select: { live: { select: { id: true, status: true, scheduledAt: true, startedAt: true, endedAt: true } } },
  }) : null;
  const live = registration?.live;
  const eligible = live && !live.endedAt && (current.trigger === "live_started"
    ? live.status === "live" && live.startedAt
    : live.status === "scheduled" && !live.startedAt && live.scheduledAt > now);
  if (!eligible || !live) return "line_registration_unavailable";
  const expectedKey = current.trigger === "registration_confirmed"
    ? stableLineIdempotencyKey(["registration_confirmed", current.identity.subjectId])
    : stableLineIdempotencyKey([current.trigger, live.id, current.identity.subjectId, current.trigger === "live_started" ? live.startedAt : live.scheduledAt]);
  if (current.idempotencyKey !== expectedKey) return "line_event_changed";
  const template = await findLineWebinarTemplate(db, current.vendorId, current.trigger);
  if (!template) return current.sourceTemplateId || fingerprint ? "line_template_changed" : null;
  if (!template.isActive || template.id !== current.sourceTemplateId || fingerprint !== lineWebinarTemplateFingerprint(template)) return "line_template_changed";
  return null;
}

export async function processDueLineDeliveries(
  db: LineWebinarDeliveryDatabase = getDb(),
  clientFactory: LineClientFactory = (accessToken) => new LineFetchClient(accessToken),
  now = new Date(),
  scope: LineDeliveryProcessingScope = {},
) {
  if (scope.deliveryIds && !scope.vendorId) {
    // Delivery IDs alone are not a tenant boundary. Internal callers that
    // dispatch an event-specific batch must always prove its vendor first.
    throw new Error("LINE delivery ID scopes require a vendor ID.");
  }
  const scopeWhere = {
    ...(scope.vendorId ? { vendorId: scope.vendorId } : {}),
    ...(scope.deliveryIds ? { id: { in: [...scope.deliveryIds] } } : {}),
  };
  await db.lineDelivery.updateMany({
    where: {
      ...scopeWhere,
      status: "sending",
      claimedAt: { lt: new Date(now.getTime() - DELIVERY_LEASE_MS) },
    },
    data: { status: "failed", claimedAt: null, nextAttemptAt: now, lastErrorCode: "worker_lease_expired" },
  });
  const due = await db.lineDelivery.findMany({
    where: { ...scopeWhere, status: { in: ["queued", "failed"] }, nextAttemptAt: { lte: now } },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    take: 50,
    include: { account: true, identity: true },
  });
  const results: Array<{ id: string; status: "sent" | "failed" | "exhausted" | "suppressed" | "claimed_elsewhere" }> = [];
  for (const delivery of due) {
    let claim: {count:number};
    try {
    claim = await db.$transaction(async tx => {
      // This Serializable read participates in the Project switch transaction.
      // A switch either precedes this claim, or observes an in-flight push.
      await resolveSubjectLineAccount(tx, delivery.vendorId, delivery.identity.subjectType, delivery.identity.subjectId);
      return tx.lineDelivery.updateMany({
      where: {
        id: delivery.id,
        vendorId: delivery.vendorId,
        status: { in: ["queued", "failed"] },
        attemptCount: delivery.attemptCount,
      },
      data: { status: "sending", claimedAt: now, attemptCount: { increment: 1 }, nextAttemptAt: null },
      });
    }, {isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    } catch {
      results.push({id:delivery.id,status:"claimed_elsewhere"}); continue;
    }
    if (claim.count !== 1) {
      results.push({ id: delivery.id, status: "claimed_elsewhere" });
      continue;
    }
    const current = await db.lineDelivery.findFirst({
      where: { id: delivery.id, vendorId: delivery.vendorId },
      include: { account: true, identity: true },
    });
    if (!hasDeliveryConsent(current)) {
      await db.lineDelivery.updateMany({
        where: { id: delivery.id, vendorId: delivery.vendorId, status: "sending" },
        data: { status: "suppressed", claimedAt: null, nextAttemptAt: null, lastErrorCode: "line_consent_unavailable" },
      });
      results.push({ id: delivery.id, status: "suppressed" });
      continue;
    }
    try {
      const selectedAccount = await resolveSubjectLineAccount(db, current.vendorId, current.identity.subjectType, current.identity.subjectId);
      if (!selectedAccount || selectedAccount.id !== current.lineOfficialAccountId || selectedAccount.status !== "active") {
        await db.lineDelivery.updateMany({ where: { id: current.id, vendorId: current.vendorId, status: "sending" }, data: { status: "suppressed", claimedAt: null, nextAttemptAt: null, lastErrorCode: "line_project_account_changed" } });
        results.push({ id: current.id, status: "suppressed" }); continue;
      }
      const payload = safePayload(decryptSensitiveValue(current.payloadEncrypted, deliveryPurpose(current.vendorId, current.id)));
      const suppression = await checkWebinarDeliverySource(db, current, payload.templateFingerprint, now);
      if (suppression) {
        await db.lineDelivery.updateMany({ where: { id: current.id, vendorId: current.vendorId, status: "sending" }, data: { status: "suppressed", claimedAt: null, nextAttemptAt: null, lastErrorCode: suppression } });
        results.push({ id: current.id, status: "suppressed" });continue;
      }
      const credentials = unprotectLineOfficialAccountCredentials(current.vendorId, current.account);
      const recipient = unprotectLineProfileValue(current.vendorId, "userId", current.identity.lineUserIdEncrypted);
      await clientFactory(credentials.messagingAccessToken).push(recipient, payload.messages, { retryKey: current.id });
      await db.lineDelivery.updateMany({
        where: { id: delivery.id, vendorId: delivery.vendorId, status: "sending" },
        data: { status: "sent", sentAt: now, claimedAt: null, lastErrorCode: null },
      });
      results.push({ id: delivery.id, status: "sent" });
    } catch (error) {
      // LINE returns 409 when the same X-Line-Retry-Key was already accepted.
      // Treat it as delivered so an ambiguous network response converges.
      if (error instanceof LineMessagingError && error.status === 409) {
        await db.lineDelivery.updateMany({
          where: { id: delivery.id, vendorId: delivery.vendorId, status: "sending" },
          data: { status: "sent", sentAt: now, claimedAt: null, lastErrorCode: null },
        });
        results.push({ id: delivery.id, status: "sent" });
        continue;
      }
      const permanentProviderRejection = error instanceof LineMessagingError
        && error.status !== undefined
        && error.status >= 400
        && error.status < 500
        && ![408, 429].includes(error.status);
      const exhausted = permanentProviderRejection || delivery.attemptCount + 1 >= delivery.maxAttempts;
      const retryAt = exhausted ? null : new Date(now.getTime() + Math.min(60, 2 ** delivery.attemptCount) * 60_000);
      await db.lineDelivery.updateMany({
        where: { id: delivery.id, vendorId: delivery.vendorId, status: "sending" },
        data: { status: exhausted ? "exhausted" : "failed", claimedAt: null, nextAttemptAt: retryAt, lastErrorCode: permanentProviderRejection ? "provider_rejected" : "provider_failed" },
      });
      results.push({ id: delivery.id, status: exhausted ? "exhausted" : "failed" });
    }
  }
  return results;
}

export function stableLineIdempotencyKey(parts: readonly (string | number | Date | null)[]) {
  return `line:v1:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}
