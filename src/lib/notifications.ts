import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { sendTransactionalEmail } from "@/lib/email";

const DELIVERY_LEASE_MS = 5 * 60 * 1000;

function renderTemplate(value: string, variables: Record<string, string>) {
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => variables[key] ?? "");
}

export async function enqueueRegistrationConfirmation(
  tx: Prisma.TransactionClient,
  input: {
    vendorId: string;
    submissionId: string;
    recipient: string;
    name: string;
    liveTitle?: string | null;
    preferredTemplateId?: string | null;
    scheduledAt?: Date;
  },
) {
  const idempotencyKey = `registration-confirmed:${input.submissionId}:email`;
  await tx.$queryRaw`SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${`notification-idempotency:${idempotencyKey}`}, 0))`;
  const existing = await tx.notificationOutbox.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  const template = await tx.messageTemplate.findFirst({
    where: {
      vendorId: input.vendorId,
      isActive: true,
      channel: "email",
      trigger: "registration_confirmed",
      ...(input.preferredTemplateId ? { id: input.preferredTemplateId } : {}),
    },
    orderBy: { createdAt: "asc" },
  }) ?? (input.preferredTemplateId
    ? await tx.messageTemplate.findFirst({
        where: {
          vendorId: input.vendorId,
          isActive: true,
          channel: "email",
          trigger: "registration_confirmed",
        },
        orderBy: { createdAt: "asc" },
      })
    : null);
  if (!template) return null;

  const normalizedRecipient = input.recipient.trim().toLowerCase();
  await tx.$queryRaw`SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${`notification-recipient:${input.vendorId}:${normalizedRecipient}`}, 0))`;
  const recipientSendCount = await tx.notificationOutbox.count({
    where: {
      vendorId: input.vendorId,
      recipient: normalizedRecipient,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  if (recipientSendCount >= 3) {
    await tx.auditLog.create({
      data: {
        vendorId: input.vendorId,
        actorLabel: "notification_outbox",
        action: "notification_recipient_rate_limited",
        targetType: "NotificationOutbox",
        after: { sourceType: "form_submission", sourceId: input.submissionId },
      },
    });
    return null;
  }

  const reserved = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE "VendorUsageLimit"
    SET "notificationEmailsUsed" = CASE
          WHEN "resetAt" <= CURRENT_TIMESTAMP THEN 1
          ELSE "notificationEmailsUsed" + 1
        END,
        "resetAt" = CASE
          WHEN "resetAt" <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + INTERVAL '1 month'
          ELSE "resetAt"
        END,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "vendorId" = ${input.vendorId}
      AND (
        "resetAt" <= CURRENT_TIMESTAMP
        OR "notificationEmailsUsed" < "notificationEmailsLimit"
      )
    RETURNING "id"
  `;
  if (reserved.length !== 1) {
    await tx.auditLog.create({
      data: {
        vendorId: input.vendorId,
        actorLabel: "notification_outbox",
        action: "notification_quota_exhausted",
        targetType: "VendorUsageLimit",
        targetId: input.vendorId,
        after: { sourceType: "form_submission", sourceId: input.submissionId },
      },
    });
    return null;
  }

  const variables = {
    name: input.name,
    live_title: input.liveTitle ?? "活動",
  };
  const scheduledAt = input.scheduledAt ?? new Date();
  return tx.notificationOutbox.upsert({
    where: { idempotencyKey },
    create: {
      vendorId: input.vendorId,
      templateId: template.id,
      channel: "email",
      recipient: normalizedRecipient,
      subject: renderTemplate(template.subject ?? `${variables.live_title} 報名成功`, variables),
      body: renderTemplate(template.body, variables),
      sourceType: "form_submission",
      sourceId: input.submissionId,
      idempotencyKey,
      payload: variables,
      scheduledAt,
      nextAttemptAt: scheduledAt,
    },
    update: {},
  });
}

function retryDate(now: Date, attemptNumber: number) {
  const delayMinutes = Math.min(60, 2 ** Math.max(0, attemptNumber - 1));
  return new Date(now.getTime() + delayMinutes * 60_000);
}

async function deliver(outbox: { idempotencyKey: string; recipient: string; subject: string; body: string }) {
  const mode = process.env.NOTIFICATION_DELIVERY_MODE ?? (process.env.NODE_ENV === "production" ? "resend" : "fixture");
  if (mode === "fixture") {
    return { provider: "fixture", messageId: `fixture:${outbox.idempotencyKey}` };
  }
  const response = await sendTransactionalEmail({
    to: outbox.recipient,
    subject: outbox.subject,
    text: outbox.body,
    idempotencyKey: outbox.idempotencyKey,
  }) as { id?: string };
  return { provider: "resend", messageId: response.id ?? null };
}

export async function processNotificationOutboxItem(outboxId: string, now = new Date()) {
  const db = getDb();
  const candidate = await db.notificationOutbox.findFirst({
    where: {
      id: outboxId,
      scheduledAt: { lte: now },
      nextAttemptAt: { lte: now },
      OR: [
        { status: { in: ["pending", "failed"] } },
        { status: "sending", nextAttemptAt: { lte: now } },
      ],
    },
  });
  if (!candidate) return { status: "skipped" as const };

  if (candidate.attemptCount >= candidate.maxAttempts) {
    await db.notificationOutbox.updateMany({
      where: { id: candidate.id, attemptCount: { gte: candidate.maxAttempts } },
      data: { status: "exhausted" },
    });
    return { status: "exhausted" as const };
  }

  const claimed = await db.notificationOutbox.updateMany({
    where: {
      id: candidate.id,
      status: candidate.status,
      attemptCount: candidate.attemptCount,
      nextAttemptAt: { lte: now },
    },
    data: {
      status: "sending",
      attemptCount: { increment: 1 },
      nextAttemptAt: new Date(now.getTime() + DELIVERY_LEASE_MS),
    },
  });
  if (claimed.count !== 1) return { status: "claimed_elsewhere" as const };

  const current = await db.notificationOutbox.findUniqueOrThrow({ where: { id: candidate.id } });
  try {
    const delivery = await deliver(current);
    await db.$transaction([
      db.notificationDeliveryAttempt.create({
        data: {
          outboxId: current.id,
          attemptNumber: current.attemptCount,
          provider: delivery.provider,
          status: "sent",
          providerMessageId: delivery.messageId,
        },
      }),
      db.notificationOutbox.update({
        where: { id: current.id },
        data: {
          status: "sent",
          providerMessageId: delivery.messageId,
          sentAt: now,
          lastError: null,
          nextAttemptAt: now,
        },
      }),
      db.auditLog.create({
        data: {
          vendorId: current.vendorId,
          actorLabel: "notification_worker",
          action: "notification_sent",
          targetType: "NotificationOutbox",
          targetId: current.id,
          after: { channel: current.channel, provider: delivery.provider, attemptNumber: current.attemptCount },
        },
      }),
    ]);
    return { status: "sent" as const, outboxId: current.id };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown notification delivery error";
    const exhausted = current.attemptCount >= current.maxAttempts;
    await db.$transaction([
      db.notificationDeliveryAttempt.create({
        data: {
          outboxId: current.id,
          attemptNumber: current.attemptCount,
          provider: process.env.NOTIFICATION_DELIVERY_MODE === "resend" ? "resend" : "fixture",
          status: "failed",
          errorMessage: message,
        },
      }),
      db.notificationOutbox.update({
        where: { id: current.id },
        data: {
          status: exhausted ? "exhausted" : "failed",
          lastError: message,
          nextAttemptAt: exhausted ? now : retryDate(now, current.attemptCount),
        },
      }),
      db.auditLog.create({
        data: {
          vendorId: current.vendorId,
          actorLabel: "notification_worker",
          action: exhausted ? "notification_exhausted" : "notification_failed",
          targetType: "NotificationOutbox",
          targetId: current.id,
          after: { attemptNumber: current.attemptCount, error: message },
        },
      }),
    ]);
    return { status: exhausted ? "exhausted" as const : "failed" as const, outboxId: current.id };
  }
}

export async function processDueNotifications(now = new Date(), limit = 25) {
  const due = await getDb().notificationOutbox.findMany({
    where: {
      scheduledAt: { lte: now },
      nextAttemptAt: { lte: now },
      status: { in: ["pending", "failed", "sending"] },
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(1, Math.min(limit, 100)),
    select: { id: true },
  });
  return Promise.all(due.map((item) => processNotificationOutboxItem(item.id, now)));
}

export async function queueNotificationRetry(input: {
  vendorId: string;
  outboxId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return getDb().$transaction(async (tx) => {
    const outbox = await tx.notificationOutbox.findFirst({
      where: { id: input.outboxId, vendorId: input.vendorId, status: { in: ["failed", "exhausted"] } },
    });
    if (!outbox) return null;
    return tx.notificationOutbox.update({
      where: { id: outbox.id },
      data: {
        status: "pending",
        nextAttemptAt: now,
        attemptCount: outbox.status === "exhausted" ? 0 : outbox.attemptCount,
        lastError: null,
      },
    });
  });
}
