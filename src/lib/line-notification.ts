import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { getDb } from "@/lib/db";
import { LineFetchClient, type LineFlexContents, type LineMessage, type LineMessagingClient } from "@/lib/line-client";
import { unprotectLineOfficialAccountCredentials, unprotectLineProfileValue } from "@/lib/line-credentials";
import { decryptSensitiveValue, encryptSensitiveValue } from "@/lib/sensitive-data";

export const LINE_NOTIFICATION_TRIGGERS = [
  "live_reminder",
  "live_started",
  "order_created",
  "order_paid",
  "commission_credited",
] as const;
export type LineNotificationTrigger = typeof LINE_NOTIFICATION_TRIGGERS[number];

type LineNotificationDatabase = Pick<PrismaClient, "lineOfficialAccount" | "lineUserIdentity" | "lineDelivery">;
type LineClientFactory = (accessToken: string) => LineMessagingClient;
const DELIVERY_LEASE_MS = 5 * 60_000;

const money = new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 });

function textComponent(text: string, weight: "regular" | "bold" = "regular") {
  return { type: "text", text, wrap: true, weight, color: "#1f2937" };
}

function actionButton(label: string, uri: string) {
  const url = new URL(uri);
  if (!new Set(["https:", "http:"]).has(url.protocol)) throw new Error("Invalid LINE action URL.");
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

function deliveryPurpose(vendorId: string, deliveryId: string) {
  return `line-delivery:${vendorId}:${deliveryId}`;
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Materializes an encrypted, tenant-idempotent LINE outbox entry. */
export async function enqueueLineNotification(
  db: LineNotificationDatabase,
  input: {
    vendorId: string;
    subjectType: "user" | "promoter" | "buyer_order" | "buyer_registration";
    subjectId: string;
    trigger: LineNotificationTrigger;
    idempotencyKey: string;
    messages: readonly LineMessage[];
    dueAt?: Date;
    sourceTemplateId?: string | null;
  },
) {
  if (!LINE_NOTIFICATION_TRIGGERS.includes(input.trigger) || !input.idempotencyKey || input.idempotencyKey.length > 255) {
    throw new Error("Invalid LINE notification.");
  }
  const [account, identity] = await Promise.all([
    db.lineOfficialAccount.findUnique({ where: { vendorId: input.vendorId }, select: { id: true, status: true } }),
    db.lineUserIdentity.findUnique({
      where: { vendorId_subjectType_subjectId: { vendorId: input.vendorId, subjectType: input.subjectType, subjectId: input.subjectId } },
      select: { id: true, revokedAt: true },
    }),
  ]);
  if (!account || account.status !== "active" || !identity || identity.revokedAt) return { status: "not_linked" as const };
  const id = randomUUID();
  const payloadEncrypted = encryptSensitiveValue(JSON.stringify(input.messages), deliveryPurpose(input.vendorId, id));
  try {
    const delivery = await db.lineDelivery.create({
      data: {
        id,
        vendorId: input.vendorId,
        lineOfficialAccountId: account.id,
        lineUserIdentityId: identity.id,
        sourceTemplateId: input.sourceTemplateId ?? null,
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
      where: { vendorId_idempotencyKey: { vendorId: input.vendorId, idempotencyKey: input.idempotencyKey } },
      select: { id: true },
    });
    return { status: "duplicate" as const, deliveryId: existing?.id ?? null };
  }
}

function safeMessages(value: string): LineMessage[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 5) throw new Error("Invalid LINE delivery payload.");
  return parsed as LineMessage[];
}

export async function processDueLineDeliveries(
  db: LineNotificationDatabase = getDb(),
  clientFactory: LineClientFactory = (accessToken) => new LineFetchClient(accessToken),
  now = new Date(),
) {
  await db.lineDelivery.updateMany({
    where: { status: "sending", claimedAt: { lt: new Date(now.getTime() - DELIVERY_LEASE_MS) } },
    data: { status: "failed", claimedAt: null, nextAttemptAt: now, lastErrorCode: "worker_lease_expired" },
  });
  const due = await db.lineDelivery.findMany({
    where: { status: { in: ["queued", "failed"] }, nextAttemptAt: { lte: now } },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    take: 50,
    include: { account: true, identity: true },
  });
  const results: Array<{ id: string; status: "sent" | "failed" | "exhausted" | "suppressed" | "claimed_elsewhere" }> = [];
  for (const delivery of due) {
    const claim = await db.lineDelivery.updateMany({
      where: { id: delivery.id, status: { in: ["queued", "failed"] }, attemptCount: delivery.attemptCount },
      data: { status: "sending", claimedAt: now, attemptCount: { increment: 1 }, nextAttemptAt: null },
    });
    if (claim.count !== 1) {
      results.push({ id: delivery.id, status: "claimed_elsewhere" });
      continue;
    }
    const current = await db.lineDelivery.findUnique({
      where: { id: delivery.id },
      include: { account: true, identity: true },
    });
    if (
      !current
      || current.vendorId !== current.account.vendorId
      || current.vendorId !== current.identity.vendorId
      || current.account.status !== "active"
      || current.identity.revokedAt
    ) {
      await db.lineDelivery.update({
        where: { id: delivery.id },
        data: { status: "suppressed", claimedAt: null, nextAttemptAt: null, lastErrorCode: "line_consent_unavailable" },
      });
      results.push({ id: delivery.id, status: "suppressed" });
      continue;
    }
    try {
      const credentials = unprotectLineOfficialAccountCredentials(current.vendorId, current.account);
      const recipient = unprotectLineProfileValue(current.vendorId, "userId", current.identity.lineUserIdEncrypted);
      const messages = safeMessages(decryptSensitiveValue(current.payloadEncrypted, deliveryPurpose(current.vendorId, current.id)));
      await clientFactory(credentials.messagingAccessToken).push(recipient, messages, { retryKey: current.id });
      await db.lineDelivery.update({ where: { id: delivery.id }, data: { status: "sent", sentAt: now, claimedAt: null, lastErrorCode: null } });
      results.push({ id: delivery.id, status: "sent" });
    } catch {
      const exhausted = delivery.attemptCount + 1 >= delivery.maxAttempts;
      const retryAt = exhausted ? null : new Date(now.getTime() + Math.min(60, 2 ** delivery.attemptCount) * 60_000);
      await db.lineDelivery.update({
        where: { id: delivery.id },
        data: { status: exhausted ? "exhausted" : "failed", claimedAt: null, nextAttemptAt: retryAt, lastErrorCode: "provider_failed" },
      });
      results.push({ id: delivery.id, status: exhausted ? "exhausted" : "failed" });
    }
  }
  return results;
}

export function stableLineIdempotencyKey(parts: readonly (string | number | Date | null)[]) {
  return `line:v1:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}
