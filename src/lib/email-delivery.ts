import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { sendTransactionalEmail, TransactionalEmailError } from "@/lib/email";
import {
  createEmailUnsubscribeUrl,
  protectEmailDeliveryPayload,
  revealEmailDeliveryPayload,
  type VendorEmailBrandSource,
} from "@/lib/email-delivery-pii";
import { hasOnlySupportedMessageTemplateVariables } from "@/lib/message-template";
import { normalizeBlacklistIdentifier } from "@/lib/blacklist-identifiers";
import { captureOperationalError } from "@/lib/monitoring";
import {
  createFormSubmissionVerificationToken,
  createFormSubmissionVerificationUrl,
} from "@/lib/form-submission-verification";
import {
  postLiveFollowupIdempotencyPrefix,
  resolveLiveCompletionAt,
  resolvePostLiveDeliveryAt,
  rotatingPostLivePageSkip,
  stablePostLiveFollowupDeliveryId,
} from "@/lib/post-live-followup";
import {
  isCurrentLiveNotificationDeliverySnapshot,
  materializeLiveNotificationsForSubmission,
} from "@/lib/live-notification-delivery";

const DELIVERY_LEASE_MS = 10 * 60 * 1_000;
const MAX_ATTEMPTS = 5;
const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*(name|live_title|live_start_at|vendor_name|unsubscribe_url)\s*\}\}/gu;

export type RegistrationConfirmationInput = {
  vendorId: string;
  vendorName: string;
  liveId: string;
  liveTitle: string;
  formSubmissionId: string;
  recipientName: string;
  recipientEmail: string;
  liveScheduledAt: Date;
  emailBrand?: VendorEmailBrandSource;
  template: {
    id: string;
    vendorId: string;
    channel: string;
    trigger: string;
    subject: string | null;
    body: string;
    isActive: boolean;
  } | null;
};

export type LiveReminderDeliveryInput = RegistrationConfirmationInput & {
  reminderOffsetMinutes: number;
};

export type PostLiveFollowupDeliveryInput = RegistrationConfirmationInput & {
  rule: {
    id: string;
    vendorId: string;
    liveId: string;
    trigger: string;
    offsetMinutes: number;
    isActive: boolean;
  };
  streamMode: string;
  endedAt: Date | null;
  videoDurationSec: number | null;
  verificationStatus: string;
};

export type LiveReminderReconciliationGuard = {
  jobId: string;
  configDigest: string;
};

export type FormSubmissionVerificationDeliveryInput = {
  vendorId: string;
  vendorName: string;
  liveId: string | null;
  formSubmissionId: string;
  recipientName: string;
  recipientEmail: string;
  verificationVersion: number;
  verificationExpiresAt: Date;
  emailBrand?: VendorEmailBrandSource;
};

function stableDeliveryId(input: Pick<RegistrationConfirmationInput, "vendorId" | "formSubmissionId"> & { templateId: string }) {
  const digest = createHash("sha256")
    .update(JSON.stringify([input.vendorId, input.formSubmissionId, input.templateId, "registration_confirmed"]))
    .digest("hex")
    .slice(0, 32);
  return `email_${digest}`;
}

function renderTemplate(value: string, variables: Record<"name" | "live_title" | "live_start_at" | "vendor_name" | "unsubscribe_url", string>) {
  return value.replace(TEMPLATE_VARIABLE_PATTERN, (_, variable: keyof typeof variables) => variables[variable]);
}

function ensureEmailUnsubscribeFooter(body: string, unsubscribeUrl: string) {
  const renderedBody = body.trim();
  if (renderedBody.includes(unsubscribeUrl)) return renderedBody;
  return [renderedBody, `退訂：${unsubscribeUrl}`].filter(Boolean).join("\n\n");
}

function formatLiveStartAt(value: Date) {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(value);
}

function isUniqueConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function isCurrentReconciliationJob(
  tx: Prisma.TransactionClient,
  input: Pick<LiveReminderDeliveryInput, "vendorId" | "liveId">,
  guard: LiveReminderReconciliationGuard | undefined,
) {
  if (!guard) return true;
  const current = await tx.liveReminderReconciliationJob.findFirst({
    where: {
      id: guard.jobId,
      vendorId: input.vendorId,
      liveId: input.liveId,
      configDigest: guard.configDigest,
      lifecycle: "processing",
    },
    select: { id: true },
  });
  return Boolean(current);
}

/**
 * Creates one immutable delivery snapshot per registration/template pair.
 * Calling this again is safe and returns the already-created ledger row.
 */
export async function ensureRegistrationConfirmationDelivery(input: RegistrationConfirmationInput) {
  try {
    await materializeLiveNotificationsForSubmission({
      vendorId: input.vendorId,
      liveId: input.liveId,
      submissionId: input.formSubmissionId,
    });
  } catch (error) {
    reportDeliveryFailure(error, "verified_submission_materialize", "failed");
  }
  const template = input.template;
  if (
    !template?.isActive
    || template.vendorId !== input.vendorId
    || template.channel !== "email"
    || template.trigger !== "registration_confirmed"
    || !template.subject
    || !hasOnlySupportedMessageTemplateVariables(template.subject)
    || !hasOnlySupportedMessageTemplateVariables(template.body)
  ) {
    return { status: "not_configured" as const };
  }

  const db = getDb();
  const deliveryId = stableDeliveryId({
    vendorId: input.vendorId,
    formSubmissionId: input.formSubmissionId,
    templateId: template.id,
  });
  const unsubscribeUrl = createEmailUnsubscribeUrl(deliveryId);
  const variables = {
    name: input.recipientName,
    live_title: input.liveTitle,
    live_start_at: formatLiveStartAt(input.liveScheduledAt),
    vendor_name: input.vendorName,
    unsubscribe_url: unsubscribeUrl,
  };
  const subject = renderTemplate(template.subject, variables).replace(/\s+/gu, " ").trim();
  const body = ensureEmailUnsubscribeFooter(renderTemplate(template.body, variables), unsubscribeUrl);
  const protectedPayload = protectEmailDeliveryPayload({
    recipientEmail: input.recipientEmail,
    subject,
    body,
    brand: input.emailBrand,
  }, {
    vendorId: input.vendorId,
    deliveryId,
  });
  const suppression = await db.emailSuppression.findUnique({
    where: {
      vendorId_recipientHash: {
        vendorId: input.vendorId,
        recipientHash: protectedPayload.recipientHash,
      },
    },
    select: { id: true, resubscribedAt: true },
  });
  const isSuppressed = Boolean(suppression && !suppression.resubscribedAt);
  const idempotencyKey = `registration-confirmed/${deliveryId}`;

  try {
    const delivery = await db.emailDelivery.create({
      data: {
        id: deliveryId,
        vendorId: input.vendorId,
        sourceTemplateId: template.id,
        sourceLiveId: input.liveId,
        sourceFormSubmissionId: input.formSubmissionId,
        trigger: "registration_confirmed",
        ...protectedPayload,
        idempotencyKey,
        status: isSuppressed ? "suppressed" : "queued",
        maxAttempts: MAX_ATTEMPTS,
        nextAttemptAt: isSuppressed ? null : new Date(),
        lastErrorCode: isSuppressed ? "recipient_suppressed" : null,
      },
      select: { id: true, status: true },
    });
    return { status: delivery.status === "suppressed" ? "suppressed" as const : "queued" as const, deliveryId: delivery.id };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const existing = await db.emailDelivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, status: true },
    });
    if (!existing) throw error;
    return { status: "duplicate" as const, deliveryId: existing.id, deliveryStatus: existing.status };
  }
}

function stableLiveReminderDeliveryId(
  input: Pick<LiveReminderDeliveryInput, "vendorId" | "liveId" | "liveTitle" | "formSubmissionId" | "liveScheduledAt" | "reminderOffsetMinutes"> & {
    template: { id: string; subject: string; body: string };
  },
) {
  const digest = createHash("sha256")
    .update(JSON.stringify([
      input.vendorId,
      input.liveId,
      input.liveTitle,
      input.formSubmissionId,
      input.template.id,
      input.template.subject,
      input.template.body,
      input.liveScheduledAt.toISOString(),
      input.reminderOffsetMinutes,
      "live_reminder",
    ]))
    .digest("hex")
    .slice(0, 32);
  return `email_${digest}`;
}

/**
 * Creates one scheduled reminder for a verified registration. A schedule or
 * offset change receives a new deterministic id and supersedes older unsent
 * reminders for the same registration.
 */
export async function ensureLiveReminderDelivery(
  input: LiveReminderDeliveryInput,
  now = new Date(),
  options: { reconciliationGuard?: LiveReminderReconciliationGuard } = {},
) {
  const template = input.template;
  if (
    !template?.isActive
    || template.vendorId !== input.vendorId
    || template.channel !== "email"
    || template.trigger !== "live_reminder"
    || !template.subject
    || !hasOnlySupportedMessageTemplateVariables(template.subject)
    || !hasOnlySupportedMessageTemplateVariables(template.body)
  ) {
    return { status: "not_configured" as const };
  }
  if (input.liveScheduledAt <= now) return { status: "not_scheduled" as const };

  const reminderAt = new Date(input.liveScheduledAt.getTime() - input.reminderOffsetMinutes * 60_000);
  const nextAttemptAt = reminderAt > now ? reminderAt : now;
  const db = getDb();
  const deliveryId = stableLiveReminderDeliveryId({
    vendorId: input.vendorId,
    liveId: input.liveId,
    liveTitle: input.liveTitle,
    formSubmissionId: input.formSubmissionId,
    template: {
      id: template.id,
      subject: template.subject,
      body: template.body,
    },
    liveScheduledAt: input.liveScheduledAt,
    reminderOffsetMinutes: input.reminderOffsetMinutes,
  });
  const unsubscribeUrl = createEmailUnsubscribeUrl(deliveryId);
  const variables = {
    name: input.recipientName,
    live_title: input.liveTitle,
    live_start_at: formatLiveStartAt(input.liveScheduledAt),
    vendor_name: input.vendorName,
    unsubscribe_url: unsubscribeUrl,
  };
  const protectedPayload = protectEmailDeliveryPayload({
    recipientEmail: input.recipientEmail,
    subject: renderTemplate(template.subject, variables).replace(/\s+/gu, " ").trim(),
    body: ensureEmailUnsubscribeFooter(renderTemplate(template.body, variables), unsubscribeUrl),
    brand: input.emailBrand,
  }, {
    vendorId: input.vendorId,
    deliveryId,
  });
  const suppression = await db.emailSuppression.findUnique({
    where: {
      vendorId_recipientHash: {
        vendorId: input.vendorId,
        recipientHash: protectedPayload.recipientHash,
      },
    },
    select: { id: true, resubscribedAt: true },
  });
  const isSuppressed = Boolean(suppression && !suppression.resubscribedAt);
  const idempotencyKey = `live-reminder/${deliveryId}`;

  const supersedeOlderReminder: Prisma.EmailDeliveryUpdateManyArgs = {
    where: {
      vendorId: input.vendorId,
      sourceLiveId: input.liveId,
      sourceFormSubmissionId: input.formSubmissionId,
      trigger: "live_reminder",
      id: { not: deliveryId },
      status: { in: ["queued", "failed"] },
    },
    data: {
      status: "superseded",
      nextAttemptAt: null,
      claimedAt: null,
      lastErrorCode: "schedule_superseded",
    },
  };

  try {
    const delivery = await db.$transaction(async (tx) => {
      if (!await isCurrentReconciliationJob(tx, input, options.reconciliationGuard)) return null;
      await tx.emailDelivery.updateMany(supersedeOlderReminder);
      return tx.emailDelivery.create({
        data: {
          id: deliveryId,
          vendorId: input.vendorId,
          sourceTemplateId: template.id,
          sourceLiveId: input.liveId,
          sourceFormSubmissionId: input.formSubmissionId,
          trigger: "live_reminder",
          ...protectedPayload,
          idempotencyKey,
          status: isSuppressed ? "suppressed" : "queued",
          maxAttempts: MAX_ATTEMPTS,
          nextAttemptAt: isSuppressed ? null : nextAttemptAt,
          lastErrorCode: isSuppressed ? "recipient_suppressed" : null,
        },
        select: { id: true, status: true, nextAttemptAt: true },
      });
    }, { isolationLevel: "Serializable" });
    if (!delivery) return { status: "config_superseded" as const };
    return {
      status: delivery.status === "suppressed" ? "suppressed" as const : "scheduled" as const,
      deliveryId: delivery.id,
      nextAttemptAt: delivery.nextAttemptAt,
    };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    return db.$transaction(async (tx) => {
      if (!await isCurrentReconciliationJob(tx, input, options.reconciliationGuard)) {
        return { status: "config_superseded" as const };
      }
      const existing = await tx.emailDelivery.findUnique({
        where: { id: deliveryId },
        select: { id: true, status: true, nextAttemptAt: true, updatedAt: true },
      });
      if (!existing) throw error;

      if (existing.status === "superseded") {
        const claimed = await tx.emailDelivery.updateMany({
          where: {
            id: deliveryId,
            status: "superseded",
            updatedAt: existing.updatedAt,
          },
          data: {
            status: isSuppressed ? "suppressed" : "queued",
            nextAttemptAt: isSuppressed ? null : nextAttemptAt,
            claimedAt: null,
            failedAt: null,
            lastErrorCode: isSuppressed ? "recipient_suppressed" : null,
          },
        });
        if (claimed.count === 1) {
          await tx.emailDelivery.updateMany(supersedeOlderReminder);
          return {
            status: isSuppressed ? "suppressed" as const : "reactivated" as const,
            deliveryId: existing.id,
            nextAttemptAt: isSuppressed ? null : nextAttemptAt,
          };
        }
      }

      await tx.emailDelivery.updateMany(supersedeOlderReminder);
      return {
        status: "duplicate" as const,
        deliveryId: existing.id,
        deliveryStatus: existing.status,
        nextAttemptAt: existing.nextAttemptAt,
      };
    }, { isolationLevel: "Serializable" });
  }
}

/** Queues one post-live snapshot for one verified registration and rule revision. */
export async function ensurePostLiveFollowupDelivery(
  input: PostLiveFollowupDeliveryInput,
  now = new Date(),
) {
  const template = input.template;
  const rule = input.rule;
  if (
    input.verificationStatus !== "VERIFIED"
    || !rule.isActive
    || rule.vendorId !== input.vendorId
    || rule.liveId !== input.liveId
    || rule.trigger !== "post_live_followup"
    || !template?.isActive
    || template.vendorId !== input.vendorId
    || template.channel !== "email"
    || template.trigger !== "post_live_followup"
    || !template.subject
    || !hasOnlySupportedMessageTemplateVariables(template.subject)
    || !hasOnlySupportedMessageTemplateVariables(template.body)
  ) return { status: "not_configured" as const };

  const completionAt = resolveLiveCompletionAt({
    streamMode: input.streamMode,
    scheduledAt: input.liveScheduledAt,
    endedAt: input.endedAt,
    videoDurationSec: input.videoDurationSec,
  });
  const deliveryAt = resolvePostLiveDeliveryAt({
    streamMode: input.streamMode,
    scheduledAt: input.liveScheduledAt,
    endedAt: input.endedAt,
    videoDurationSec: input.videoDurationSec,
  }, rule.offsetMinutes);
  if (!completionAt || !deliveryAt || deliveryAt > now) return { status: "not_due" as const };

  const deliveryId = stablePostLiveFollowupDeliveryId({
    vendorId: input.vendorId,
    liveId: input.liveId,
    liveTitle: input.liveTitle,
    liveScheduledAt: input.liveScheduledAt,
    formSubmissionId: input.formSubmissionId,
    ruleId: rule.id,
    offsetMinutes: rule.offsetMinutes,
    completionAt,
    template: { id: template.id, subject: template.subject, body: template.body },
  });
  const variables = {
    name: input.recipientName,
    live_title: input.liveTitle,
    live_start_at: formatLiveStartAt(input.liveScheduledAt),
    vendor_name: input.vendorName,
    unsubscribe_url: createEmailUnsubscribeUrl(deliveryId),
  };
  const protectedPayload = protectEmailDeliveryPayload({
    recipientEmail: input.recipientEmail,
    subject: renderTemplate(template.subject, variables).replace(/\s+/gu, " ").trim(),
    body: ensureEmailUnsubscribeFooter(renderTemplate(template.body, variables), variables.unsubscribe_url),
    brand: input.emailBrand,
  }, { vendorId: input.vendorId, deliveryId });
  const db = getDb();
  const normalizedEmail = normalizeBlacklistIdentifier("email", input.recipientEmail);
  const [suppression, blacklist] = await Promise.all([
    db.emailSuppression.findUnique({
      where: {
        vendorId_recipientHash: {
          vendorId: input.vendorId,
          recipientHash: protectedPayload.recipientHash,
        },
      },
      select: { id: true, resubscribedAt: true },
    }),
    normalizedEmail
      ? db.blacklist.findFirst({
          where: {
            vendorId: input.vendorId,
            identifierType: "email",
            identifier: normalizedEmail,
            isActive: true,
            unblockedAt: null,
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  const isSuppressed = Boolean(suppression && !suppression.resubscribedAt);
  const isBlacklisted = Boolean(blacklist);
  const idempotencyPrefix = postLiveFollowupIdempotencyPrefix(rule.id);
  const idempotencyKey = `${idempotencyPrefix}${deliveryId}`;
  const supersedeOlder: Prisma.EmailDeliveryUpdateManyArgs = {
    where: {
      vendorId: input.vendorId,
      sourceLiveId: input.liveId,
      sourceFormSubmissionId: input.formSubmissionId,
      trigger: "post_live_followup",
      id: { not: deliveryId },
      idempotencyKey: { startsWith: idempotencyPrefix },
      status: { in: ["queued", "failed"] },
    },
    data: {
      status: "superseded",
      nextAttemptAt: null,
      claimedAt: null,
      lastErrorCode: "config_superseded",
    },
  };

  try {
    const delivery = await db.$transaction(async (tx) => {
      const alreadySent = await tx.emailDelivery.findFirst({
        where: {
          vendorId: input.vendorId,
          sourceLiveId: input.liveId,
          sourceFormSubmissionId: input.formSubmissionId,
          trigger: "post_live_followup",
          idempotencyKey: { startsWith: idempotencyPrefix },
          status: "sent",
        },
        select: { id: true },
      });
      if (alreadySent) return { id: alreadySent.id, status: "sent", nextAttemptAt: null };
      await tx.emailDelivery.updateMany(supersedeOlder);
      return tx.emailDelivery.create({
        data: {
          id: deliveryId,
          vendorId: input.vendorId,
          sourceTemplateId: template.id,
          sourceLiveId: input.liveId,
          sourceFormSubmissionId: input.formSubmissionId,
          trigger: "post_live_followup",
          ...protectedPayload,
          idempotencyKey,
          status: isSuppressed || isBlacklisted ? "suppressed" : "queued",
          maxAttempts: MAX_ATTEMPTS,
          nextAttemptAt: isSuppressed || isBlacklisted ? null : now,
          lastErrorCode: isBlacklisted ? "recipient_blacklisted" : isSuppressed ? "recipient_suppressed" : null,
        },
        select: { id: true, status: true, nextAttemptAt: true },
      });
    }, { isolationLevel: "Serializable" });
    return {
      status: delivery.status === "sent"
        ? "already_sent" as const
        : delivery.status === "suppressed" ? "suppressed" as const : "queued" as const,
      deliveryId: delivery.id,
      nextAttemptAt: delivery.nextAttemptAt,
    };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const existing = await db.emailDelivery.findUnique({
      where: { vendorId_idempotencyKey: { vendorId: input.vendorId, idempotencyKey } },
      select: { id: true, status: true, nextAttemptAt: true },
    });
    if (!existing) throw error;
    return {
      status: "duplicate" as const,
      deliveryId: existing.id,
      deliveryStatus: existing.status,
      nextAttemptAt: existing.nextAttemptAt,
    };
  }
}

export async function processDuePostLiveFollowups(
  options: { now?: Date; ruleLimit?: number; recipientLimitPerRule?: number } = {},
) {
  const now = options.now ?? new Date();
  const ruleLimit = Math.min(Math.max(options.ruleLimit ?? 20, 1), 50);
  const recipientLimit = Math.min(Math.max(options.recipientLimitPerRule ?? 100, 1), 250);
  const db = getDb();
  const ruleWhere = { trigger: "post_live_followup", isActive: true } as const;
  const ruleCount = await db.liveNotificationRule.count({ where: ruleWhere });
  const rules = await db.liveNotificationRule.findMany({
    where: ruleWhere,
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    skip: rotatingPostLivePageSkip(ruleCount, ruleLimit, now),
    take: ruleLimit,
    include: {
      messageTemplate: true,
      live: { include: { vendor: true, video: true } },
    },
  });
  const results: Array<{ status: string }> = [];

  for (const rule of rules) {
    const live = rule.live;
    const deliveryAt = resolvePostLiveDeliveryAt({
      streamMode: live.streamMode,
      scheduledAt: live.scheduledAt,
      endedAt: live.endedAt,
      videoDurationSec: live.video?.durationSec ?? null,
    }, rule.offsetMinutes);
    if (!deliveryAt || deliveryAt > now) {
      results.push({ status: "not_due" });
      continue;
    }
    const submissionWhere = {
      liveId: live.id,
      verificationStatus: "VERIFIED" as const,
      form: { vendorId: rule.vendorId },
    };
    const submissionCount = await db.formSubmission.count({ where: submissionWhere });
    const submissions = await db.formSubmission.findMany({
      where: submissionWhere,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: rotatingPostLivePageSkip(submissionCount, recipientLimit, now),
      take: recipientLimit,
      select: { id: true, name: true, email: true, verificationStatus: true },
    });
    for (const submission of submissions) {
      const result = await ensurePostLiveFollowupDelivery({
        vendorId: rule.vendorId,
        vendorName: live.vendor.name,
        liveId: live.id,
        liveTitle: live.title,
        formSubmissionId: submission.id,
        recipientName: submission.name,
        recipientEmail: submission.email,
        liveScheduledAt: live.scheduledAt,
        template: rule.messageTemplate,
        rule,
        streamMode: live.streamMode,
        endedAt: live.endedAt,
        videoDurationSec: live.video?.durationSec ?? null,
        verificationStatus: submission.verificationStatus,
        emailBrand: {
          senderName: live.vendor.senderName,
          supportEmail: live.vendor.supportEmail,
          contactUrl: live.vendor.contactUrl,
        },
      }, now);
      results.push({ status: result.status });
    }
  }
  return results;
}

function stableVerificationDeliveryId(input: Pick<
  FormSubmissionVerificationDeliveryInput,
  "vendorId" | "formSubmissionId" | "verificationVersion"
>) {
  const digest = createHash("sha256")
    .update(JSON.stringify([
      input.vendorId,
      input.formSubmissionId,
      input.verificationVersion,
      "form_submission_verification",
    ]))
    .digest("hex")
    .slice(0, 32);
  return `email_${digest}`;
}

function safeDisplayText(value: string, fallback: string) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, 160) : fallback;
}

/**
 * Queues one platform-owned ownership verification email. The raw token only
 * exists inside the encrypted delivery envelope and is never stored in a
 * searchable database column or monitoring context.
 */
export async function ensureFormSubmissionVerificationDelivery(
  input: FormSubmissionVerificationDeliveryInput,
) {
  const db = getDb();
  const deliveryId = stableVerificationDeliveryId(input);
  const token = createFormSubmissionVerificationToken({
    submissionId: input.formSubmissionId,
    expiresAt: input.verificationExpiresAt,
    version: input.verificationVersion,
  });
  const verificationUrl = createFormSubmissionVerificationUrl(token);
  const recipientName = safeDisplayText(input.recipientName, "您好");
  const vendorName = safeDisplayText(input.vendorName, "活動主辦單位");
  const protectedPayload = protectEmailDeliveryPayload({
    recipientEmail: input.recipientEmail,
    subject: `請確認 ${vendorName} 的報名 Email`,
    body: `${recipientName}：\n\n請開啟以下連結，並在頁面上按下確認，完成 Email 驗證：\n${verificationUrl}\n\n連結將於 48 小時後失效。如果不是你本人送出，可以忽略這封信。`,
    brand: input.emailBrand,
  }, {
    vendorId: input.vendorId,
    deliveryId,
  });
  const suppression = await db.emailSuppression.findUnique({
    where: {
      vendorId_recipientHash: {
        vendorId: input.vendorId,
        recipientHash: protectedPayload.recipientHash,
      },
    },
    select: { id: true, resubscribedAt: true },
  });
  const isSuppressed = Boolean(suppression && !suppression.resubscribedAt);
  const idempotencyKey = `form-submission-verification/${deliveryId}`;

  try {
    const delivery = await db.emailDelivery.create({
      data: {
        id: deliveryId,
        vendorId: input.vendorId,
        sourceTemplateId: "system_form_submission_verification_v1",
        sourceLiveId: input.liveId,
        sourceFormSubmissionId: input.formSubmissionId,
        trigger: "form_submission_verification",
        ...protectedPayload,
        idempotencyKey,
        status: isSuppressed ? "suppressed" : "queued",
        maxAttempts: MAX_ATTEMPTS,
        nextAttemptAt: isSuppressed ? null : new Date(),
        lastErrorCode: isSuppressed ? "recipient_suppressed" : null,
      },
      select: { id: true, status: true },
    });
    return {
      status: delivery.status === "suppressed" ? "suppressed" as const : "queued" as const,
      deliveryId: delivery.id,
    };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const existing = await db.emailDelivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, status: true },
    });
    if (!existing) throw error;
    return { status: "duplicate" as const, deliveryId: existing.id, deliveryStatus: existing.status };
  }
}

function nextAttemptDate(attemptCount: number, now = new Date()) {
  const minutes = Math.min(60, 5 * (2 ** Math.max(0, attemptCount - 1)));
  return new Date(now.getTime() + minutes * 60_000);
}

function deliveryError(error: unknown) {
  if (error instanceof TransactionalEmailError) {
    const retryable = error.code === "configuration"
      || error.code === "network"
      || error.providerStatus === 409
      || error.providerStatus === 429
      || (error.providerStatus !== null && error.providerStatus >= 500);
    return { code: error.code, retryable };
  }
  return { code: "internal", retryable: true };
}

type ClaimedDelivery = {
  id: string;
  vendorId: string;
  sourceLiveId: string | null;
  sourceFormSubmissionId: string | null;
  trigger: string;
  payloadEncryptedEnvelope: string;
  recipientHash: string;
  idempotencyKey: string;
  attemptCount: number;
  maxAttempts: number;
};

type DeliverySnapshotDatabase = Pick<Prisma.TransactionClient, "live" | "liveNotificationRule" | "formSubmission" | "blacklist">;

export type EmailDeliverySnapshotIdentity = Pick<
  ClaimedDelivery,
  "id" | "vendorId" | "sourceLiveId" | "sourceFormSubmissionId" | "trigger"
> & { idempotencyKey?: string };

async function isCurrentLiveReminderDelivery(
  delivery: EmailDeliverySnapshotIdentity,
  now: Date,
  database: DeliverySnapshotDatabase,
) {
  if (delivery.trigger !== "live_reminder") return true;
  if (!delivery.sourceLiveId || !delivery.sourceFormSubmissionId) return false;
  const live = await database.live.findFirst({
    where: { id: delivery.sourceLiveId, vendorId: delivery.vendorId },
    select: {
      id: true,
      vendorId: true,
      title: true,
      status: true,
      scheduledAt: true,
      liveReminderOffsetMinutes: true,
      liveReminderTemplate: {
        select: { id: true, vendorId: true, channel: true, trigger: true, subject: true, body: true, isActive: true },
      },
    },
  });
  const template = live?.liveReminderTemplate;
  if (
    !live
    || !new Set(["scheduled", "live"]).has(live.status)
    || live.scheduledAt <= now
    || !template?.isActive
    || template.vendorId !== delivery.vendorId
    || template.channel !== "email"
    || template.trigger !== "live_reminder"
    || !template.subject
    || !hasOnlySupportedMessageTemplateVariables(template.subject)
    || !hasOnlySupportedMessageTemplateVariables(template.body)
  ) return false;

  return stableLiveReminderDeliveryId({
    vendorId: delivery.vendorId,
    liveId: live.id,
    liveTitle: live.title,
    formSubmissionId: delivery.sourceFormSubmissionId,
    template: { id: template.id, subject: template.subject, body: template.body },
    liveScheduledAt: live.scheduledAt,
    reminderOffsetMinutes: live.liveReminderOffsetMinutes,
  }) === delivery.id;
}

async function isCurrentPostLiveFollowupDelivery(
  delivery: EmailDeliverySnapshotIdentity,
  now: Date,
  database: DeliverySnapshotDatabase,
) {
  if (delivery.trigger !== "post_live_followup") return true;
  if (!delivery.sourceLiveId || !delivery.sourceFormSubmissionId) return false;
  const [live, submission] = await Promise.all([
    database.live.findFirst({
      where: { id: delivery.sourceLiveId, vendorId: delivery.vendorId },
      select: {
        id: true,
        vendorId: true,
        title: true,
        scheduledAt: true,
        endedAt: true,
        streamMode: true,
        video: { select: { durationSec: true } },
        notificationRules: {
          where: { trigger: "post_live_followup", isActive: true },
          select: {
            id: true,
            vendorId: true,
            liveId: true,
            trigger: true,
            offsetMinutes: true,
            isActive: true,
            messageTemplate: {
              select: { id: true, vendorId: true, channel: true, trigger: true, subject: true, body: true, isActive: true },
            },
          },
        },
      },
    }),
    database.formSubmission.findFirst({
      where: {
        id: delivery.sourceFormSubmissionId,
        liveId: delivery.sourceLiveId,
        verificationStatus: "VERIFIED",
        form: { vendorId: delivery.vendorId },
      },
      select: { id: true, email: true },
    }),
  ]);
  if (!live || !submission) return false;
  const normalizedEmail = normalizeBlacklistIdentifier("email", submission.email);
  if (!normalizedEmail) return false;
  const blacklist = await database.blacklist.findFirst({
    where: {
      vendorId: delivery.vendorId,
      identifierType: "email",
      identifier: normalizedEmail,
      isActive: true,
      unblockedAt: null,
    },
    select: { id: true },
  });
  if (blacklist) return false;
  const completionAt = resolveLiveCompletionAt({
    streamMode: live.streamMode,
    scheduledAt: live.scheduledAt,
    endedAt: live.endedAt,
    videoDurationSec: live.video?.durationSec ?? null,
  });
  if (!completionAt) return false;

  return live.notificationRules.some((rule) => {
    const template = rule.messageTemplate;
    const deliveryAt = resolvePostLiveDeliveryAt({
      streamMode: live.streamMode,
      scheduledAt: live.scheduledAt,
      endedAt: live.endedAt,
      videoDurationSec: live.video?.durationSec ?? null,
    }, rule.offsetMinutes);
    if (
      !deliveryAt
      || deliveryAt > now
      || rule.vendorId !== delivery.vendorId
      || rule.liveId !== live.id
      || !template.isActive
      || template.vendorId !== delivery.vendorId
      || template.channel !== "email"
      || template.trigger !== "post_live_followup"
      || !template.subject
      || !hasOnlySupportedMessageTemplateVariables(template.subject)
      || !hasOnlySupportedMessageTemplateVariables(template.body)
    ) return false;
    return stablePostLiveFollowupDeliveryId({
      vendorId: delivery.vendorId,
      liveId: live.id,
      liveTitle: live.title,
      liveScheduledAt: live.scheduledAt,
      formSubmissionId: submission.id,
      ruleId: rule.id,
      offsetMinutes: rule.offsetMinutes,
      completionAt,
      template: { id: template.id, subject: template.subject, body: template.body },
    }) === delivery.id;
  });
}

async function isCurrentFormVerificationDelivery(
  delivery: EmailDeliverySnapshotIdentity,
  now: Date,
  database: DeliverySnapshotDatabase,
) {
  if (delivery.trigger !== "form_submission_verification") return true;
  if (!delivery.sourceFormSubmissionId) return false;
  const submission = await database.formSubmission.findFirst({
    where: {
      id: delivery.sourceFormSubmissionId,
      form: { vendorId: delivery.vendorId },
    },
    select: {
      id: true,
      verificationStatus: true,
      verificationVersion: true,
      verificationExpiresAt: true,
    },
  });
  if (
    !submission
    || submission.verificationStatus !== "UNVERIFIED"
    || !submission.verificationExpiresAt
    || submission.verificationExpiresAt <= now
  ) return false;

  return stableVerificationDeliveryId({
    vendorId: delivery.vendorId,
    formSubmissionId: submission.id,
    verificationVersion: submission.verificationVersion,
  }) === delivery.id;
}

/**
 * Final send-time guard shared by the worker and merchant retry workflow.
 * It prevents a stale reminder or expired verification token from reaching
 * the provider after the source record changes.
 */
export async function isCurrentEmailDeliverySnapshot(
  delivery: EmailDeliverySnapshotIdentity,
  now = new Date(),
  database: DeliverySnapshotDatabase = getDb(),
) {
  return await isCurrentLiveReminderDelivery(delivery, now, database)
    && await isCurrentLiveNotificationDeliverySnapshot(delivery, now, database)
    && await isCurrentPostLiveFollowupDelivery(delivery, now, database)
    && await isCurrentFormVerificationDelivery(delivery, now, database);
}

function reportDeliveryFailure(error: unknown, operation: string, status: string) {
  try {
    captureOperationalError(error, { source: "email_delivery", operation, status });
  } catch {
    // Monitoring must never change the durable delivery state.
  }
}

async function writeDeliveryAuditSafely(input: Parameters<typeof writeAuditLog>[0], status: string) {
  try {
    await writeAuditLog(input);
  } catch (error) {
    reportDeliveryFailure(error, "audit", status);
  }
}

async function finalizeSuppressed(delivery: ClaimedDelivery) {
  const result = await getDb().emailDelivery.updateMany({
    where: { id: delivery.id, status: "sending", attemptCount: delivery.attemptCount },
    data: {
      status: "suppressed",
      nextAttemptAt: null,
      claimedAt: null,
      lastErrorCode: "recipient_suppressed",
    },
  });
  return result.count === 1 ? { status: "suppressed" as const } : { status: "claimed_elsewhere" as const };
}

async function finalizeSuperseded(delivery: ClaimedDelivery, errorCode = "config_superseded") {
  const result = await getDb().emailDelivery.updateMany({
    where: { id: delivery.id, status: "sending", attemptCount: delivery.attemptCount },
    data: {
      status: "superseded",
      nextAttemptAt: null,
      claimedAt: null,
      lastErrorCode: errorCode,
    },
  });
  return result.count === 1 ? { status: "superseded" as const } : { status: "claimed_elsewhere" as const };
}

export async function dispatchEmailDelivery(deliveryId: string, actorLabel = "job:email-delivery") {
  const db = getDb();
  const candidate = await db.emailDelivery.findUnique({ where: { id: deliveryId } });
  if (!candidate) return { status: "missing" as const };
  if (!new Set(["queued", "failed"]).has(candidate.status)) return { status: "not_due" as const };
  if (candidate.nextAttemptAt && candidate.nextAttemptAt > new Date()) return { status: "not_due" as const };

  const attemptCount = candidate.attemptCount + 1;
  const claimed = await db.emailDelivery.updateMany({
    where: {
      id: candidate.id,
      status: candidate.status,
      attemptCount: candidate.attemptCount,
      updatedAt: candidate.updatedAt,
    },
    data: {
      status: "sending",
      attemptCount: { increment: 1 },
      nextAttemptAt: null,
      claimedAt: new Date(),
      lastErrorCode: null,
    },
  });
  if (claimed.count !== 1) return { status: "claimed_elsewhere" as const };

  const delivery: ClaimedDelivery = { ...candidate, attemptCount };
  const suppression = await db.emailSuppression.findUnique({
    where: {
      vendorId_recipientHash: {
        vendorId: delivery.vendorId,
        recipientHash: delivery.recipientHash,
      },
    },
    select: { resubscribedAt: true },
  });
  if (suppression && !suppression.resubscribedAt) return finalizeSuppressed(delivery);
  if (!(await isCurrentEmailDeliverySnapshot(delivery, new Date()))) {
    return finalizeSuperseded(
      delivery,
      delivery.trigger === "form_submission_verification" ? "verification_superseded" : "config_superseded",
    );
  }

  let sent: { id: string };
  try {
    const payload = revealEmailDeliveryPayload(delivery.payloadEncryptedEnvelope, {
      vendorId: delivery.vendorId,
      deliveryId: delivery.id,
    });
    sent = await sendTransactionalEmail({
      to: payload.recipientEmail,
      subject: payload.subject,
      text: payload.body,
      idempotencyKey: delivery.idempotencyKey,
      ...(payload.brand ? { brand: payload.brand } : {}),
    });
  } catch (error) {
    const failure = deliveryError(error);
    const exhausted = !failure.retryable || attemptCount >= delivery.maxAttempts;
    const status = exhausted ? "exhausted" : "failed";
    const finalized = await db.emailDelivery.updateMany({
      where: { id: delivery.id, status: "sending", attemptCount },
      data: {
        status,
        failedAt: new Date(),
        claimedAt: null,
        nextAttemptAt: exhausted ? null : nextAttemptDate(attemptCount),
        lastErrorCode: failure.code,
      },
    });
    if (finalized.count !== 1) return { status: "claimed_elsewhere" as const };
    reportDeliveryFailure(error, "provider_send", status);
    await writeDeliveryAuditSafely({
      vendorId: delivery.vendorId,
      actorLabel,
      action: exhausted ? "email_delivery_exhausted" : "email_delivery_failed",
      targetType: "EmailDelivery",
      targetId: delivery.id,
      after: { status, errorCode: failure.code, attemptCount },
    }, status);
    return { status, errorCode: failure.code };
  }

  const finalized = await db.emailDelivery.updateMany({
    where: { id: delivery.id, status: "sending", attemptCount },
    data: {
      status: "sent",
      providerMessageId: sent.id,
      sentAt: new Date(),
      claimedAt: null,
      nextAttemptAt: null,
      lastErrorCode: null,
    },
  });
  if (finalized.count !== 1) return { status: "claimed_elsewhere" as const };
  await writeDeliveryAuditSafely({
    vendorId: delivery.vendorId,
    actorLabel,
    action: "email_delivery_sent",
    targetType: "EmailDelivery",
    targetId: delivery.id,
    after: { status: "sent", trigger: candidate.trigger, attemptCount },
  }, "sent");
  return { status: "sent" as const };
}

export async function processDueEmailDeliveries(limit = 20) {
  const db = getDb();
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - DELIVERY_LEASE_MS);
  const stale = await db.emailDelivery.findMany({
    where: { status: "sending", claimedAt: { lte: staleCutoff } },
    orderBy: { claimedAt: "asc" },
    take: limit,
  });
  const results: Array<{ deliveryId: string; status: string }> = [];

  for (const delivery of stale) {
    const exhausted = delivery.attemptCount >= delivery.maxAttempts;
    const recovered = await db.emailDelivery.updateMany({
      where: {
        id: delivery.id,
        status: "sending",
        attemptCount: delivery.attemptCount,
        updatedAt: delivery.updatedAt,
      },
      data: {
        status: exhausted ? "exhausted" : "failed",
        claimedAt: null,
        nextAttemptAt: exhausted ? null : now,
        lastErrorCode: "stale_delivery_lease",
      },
    });
    results.push({ deliveryId: delivery.id, status: recovered.count === 1 ? (exhausted ? "exhausted" : "recovered") : "claimed_elsewhere" });
  }

  const remaining = Math.max(0, limit - results.length);
  if (remaining === 0) return results;
  const due = await db.emailDelivery.findMany({
    where: {
      status: { in: ["queued", "failed"] },
      nextAttemptAt: { lte: now },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: remaining,
    select: { id: true },
  });
  for (const delivery of due) {
    const result = await dispatchEmailDelivery(delivery.id);
    results.push({ deliveryId: delivery.id, status: result.status });
  }
  return results;
}
