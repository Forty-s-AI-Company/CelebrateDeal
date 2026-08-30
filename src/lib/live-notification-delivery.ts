import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { normalizeBlacklistIdentifier } from "@/lib/blacklist-identifiers";
import { getDb } from "@/lib/db";
import {
  createEmailUnsubscribeUrl,
  protectEmailDeliveryPayload,
  type VendorEmailBrandSource,
} from "@/lib/email-delivery-pii";
import { hasOnlySupportedMessageTemplateVariables, renderMessageTemplate } from "@/lib/message-template";
import { createLiveViewerUrl } from "@/lib/live-public-url";
import { captureOperationalError } from "@/lib/monitoring";
import {
  LIVE_NOTIFICATION_DELIVERY_TRIGGERS,
  liveNotificationIdempotencyPrefix,
  liveNotificationIdentityFromKey,
  type LiveNotificationDeliveryTrigger,
} from "@/lib/live-notification-identity";

const MAX_ATTEMPTS = 5;
const CUTOVER_RECIPIENT_LIMIT = 250;

type NotificationTemplate = {
  id: string;
  vendorId: string;
  channel: string;
  trigger: string;
  subject: string | null;
  body: string;
  isActive: boolean;
};

type NotificationRule = {
  id: string;
  vendorId: string;
  liveId: string;
  trigger: string;
  offsetMinutes: number;
  isActive: boolean;
  messageTemplate: NotificationTemplate;
};

type NotificationLive = {
  id: string;
  vendorId: string;
  slug: string;
  title: string;
  status: string;
  scheduledAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  liveReminderTemplateId: string | null;
  vendor: {
    name: string;
    senderName: string | null;
    supportEmail: string | null;
    contactUrl: string | null;
  };
};

type VerifiedSubmission = {
  id: string;
  name: string;
  email: string;
  verificationStatus: string;
};

type NotificationSnapshotDatabase = Pick<
  Prisma.TransactionClient,
  "live" | "liveNotificationRule" | "formSubmission" | "blacklist"
>;

function validTemplate(vendorId: string, template: NotificationTemplate, trigger: string) {
  return template.vendorId === vendorId
    && template.isActive
    && template.channel === "email"
    && template.trigger === "live_reminder"
    && Boolean(template.subject)
    && hasOnlySupportedMessageTemplateVariables(template.subject ?? "")
    && hasOnlySupportedMessageTemplateVariables(template.body)
    && LIVE_NOTIFICATION_DELIVERY_TRIGGERS.includes(trigger as LiveNotificationDeliveryTrigger);
}

export function resolveLiveNotificationDueAt(input: {
  trigger: LiveNotificationDeliveryTrigger;
  scheduledAt: Date;
  startedAt: Date | null;
  offsetMinutes: number;
}) {
  if (!Number.isInteger(input.offsetMinutes) || input.offsetMinutes < 0 || input.offsetMinutes > 10_080) return null;
  if (input.trigger === "before_live") {
    if (input.offsetMinutes < 1) return null;
    return new Date(input.scheduledAt.getTime() - input.offsetMinutes * 60_000);
  }
  return input.startedAt ? new Date(input.startedAt.getTime() + input.offsetMinutes * 60_000) : null;
}

function liveAnchor(live: Pick<NotificationLive, "scheduledAt" | "startedAt">, trigger: LiveNotificationDeliveryTrigger) {
  return trigger === "before_live" ? live.scheduledAt : live.startedAt;
}

export function stableLiveNotificationDeliveryId(input: {
  vendorId: string;
  liveId: string;
  liveSlug: string;
  liveTitle: string;
  formSubmissionId: string;
  ruleId: string;
  trigger: LiveNotificationDeliveryTrigger;
  offsetMinutes: number;
  anchor: Date;
  template: { id: string; subject: string; body: string };
}) {
  const digest = createHash("sha256").update(JSON.stringify([
    input.vendorId,
    input.liveId,
    input.liveSlug,
    input.liveTitle,
    input.formSubmissionId,
    input.ruleId,
    input.trigger,
    input.offsetMinutes,
    input.template.id,
    input.template.subject,
    input.template.body,
    input.anchor.toISOString(),
    "live_notification/v1",
  ])).digest("hex").slice(0, 32);
  return `email_${digest}`;
}

function formatLiveStartAt(value: Date) {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(value);
}

function ensureUnsubscribeFooter(body: string, unsubscribeUrl: string) {
  const rendered = body.trim();
  return rendered.includes(unsubscribeUrl) ? rendered : [rendered, `退訂：${unsubscribeUrl}`].filter(Boolean).join("\n\n");
}

function isLiveEligible(live: NotificationLive, trigger: LiveNotificationDeliveryTrigger, now: Date) {
  if (trigger === "before_live") {
    return live.status === "scheduled" && !live.startedAt && now < live.scheduledAt;
  }
  return live.status === "live" && Boolean(live.startedAt) && !live.endedAt;
}

function deliverySnapshot(input: {
  live: NotificationLive;
  rule: NotificationRule;
  submission: VerifiedSubmission;
  now: Date;
}) {
  const trigger = input.rule.trigger as LiveNotificationDeliveryTrigger;
  const template = input.rule.messageTemplate;
  const anchor = liveAnchor(input.live, trigger);
  const dueAt = resolveLiveNotificationDueAt({
    trigger,
    scheduledAt: input.live.scheduledAt,
    startedAt: input.live.startedAt,
    offsetMinutes: input.rule.offsetMinutes,
  });
  if (
    !input.rule.isActive
    || input.rule.vendorId !== input.live.vendorId
    || input.rule.liveId !== input.live.id
    || input.submission.verificationStatus !== "VERIFIED"
    || !LIVE_NOTIFICATION_DELIVERY_TRIGGERS.includes(trigger)
    || !validTemplate(input.live.vendorId, template, trigger)
    || !anchor
    || !dueAt
    || !isLiveEligible(input.live, trigger, input.now)
  ) return null;

  const deliveryId = stableLiveNotificationDeliveryId({
    vendorId: input.live.vendorId,
    liveId: input.live.id,
    liveSlug: input.live.slug,
    liveTitle: input.live.title,
    formSubmissionId: input.submission.id,
    ruleId: input.rule.id,
    trigger,
    offsetMinutes: input.rule.offsetMinutes,
    anchor,
    template: { id: template.id, subject: template.subject!, body: template.body },
  });
  return { trigger, template, dueAt, deliveryId };
}

async function buildDeliveryData(
  db: Pick<Prisma.TransactionClient, "emailSuppression" | "blacklist">,
  input: {
    live: NotificationLive;
    rule: NotificationRule;
    submission: VerifiedSubmission;
    now: Date;
    scheduleFuture: boolean;
  },
) {
  const snapshot = deliverySnapshot(input);
  if (!snapshot || (!input.scheduleFuture && snapshot.dueAt > input.now)) return null;
  const unsubscribeUrl = createEmailUnsubscribeUrl(snapshot.deliveryId);
  const variables = {
    name: input.submission.name,
    live_title: input.live.title,
    live_url: createLiveViewerUrl(input.live.slug),
    live_start_at: formatLiveStartAt(input.live.scheduledAt),
    vendor_name: input.live.vendor.name,
    unsubscribe_url: unsubscribeUrl,
  };
  const protectedPayload = protectEmailDeliveryPayload({
    recipientEmail: input.submission.email,
    subject: renderMessageTemplate(snapshot.template.subject!, variables).replace(/\s+/gu, " ").trim(),
    body: ensureUnsubscribeFooter(renderMessageTemplate(snapshot.template.body, variables), unsubscribeUrl),
    brand: {
      senderName: input.live.vendor.senderName,
      supportEmail: input.live.vendor.supportEmail,
      contactUrl: input.live.vendor.contactUrl,
    } satisfies VendorEmailBrandSource,
  }, { vendorId: input.live.vendorId, deliveryId: snapshot.deliveryId });
  const normalizedEmail = normalizeBlacklistIdentifier("email", input.submission.email);
  const [suppression, blacklist] = await Promise.all([
    db.emailSuppression.findUnique({
      where: { vendorId_recipientHash: { vendorId: input.live.vendorId, recipientHash: protectedPayload.recipientHash } },
      select: { resubscribedAt: true },
    }),
    normalizedEmail ? db.blacklist.findFirst({
      where: { vendorId: input.live.vendorId, identifierType: "email", identifier: normalizedEmail, isActive: true, unblockedAt: null },
      select: { id: true },
    }) : Promise.resolve(null),
  ]);
  const suppressed = Boolean((suppression && !suppression.resubscribedAt) || blacklist);
  return {
    id: snapshot.deliveryId,
    vendorId: input.live.vendorId,
    sourceTemplateId: snapshot.template.id,
    sourceLiveId: input.live.id,
    sourceFormSubmissionId: input.submission.id,
    trigger: snapshot.trigger,
    ...protectedPayload,
    idempotencyKey: `${liveNotificationIdempotencyPrefix(snapshot.trigger, input.rule.id)}${snapshot.deliveryId}`,
    status: suppressed ? "suppressed" : "queued",
    maxAttempts: MAX_ATTEMPTS,
    nextAttemptAt: suppressed ? null : snapshot.dueAt > input.now ? snapshot.dueAt : input.now,
    lastErrorCode: blacklist ? "recipient_blacklisted" : suppression && !suppression.resubscribedAt ? "recipient_suppressed" : null,
  };
}

function isUniqueConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function readCurrentNotificationSnapshot(
  db: Pick<Prisma.TransactionClient, "live" | "liveNotificationRule" | "formSubmission">,
  input: { vendorId: string; liveId: string; ruleId: string; submissionId: string },
) {
  const [live, rule, submission] = await Promise.all([
    db.live.findFirst({
      where: { id: input.liveId, vendorId: input.vendorId },
      select: {
        id: true, vendorId: true, slug: true, title: true, status: true, scheduledAt: true, startedAt: true, endedAt: true, liveReminderTemplateId: true,
        vendor: { select: { name: true, senderName: true, supportEmail: true, contactUrl: true } },
      },
    }),
    db.liveNotificationRule.findFirst({
      where: { id: input.ruleId, vendorId: input.vendorId, liveId: input.liveId },
      include: { messageTemplate: true },
    }),
    db.formSubmission.findFirst({
      where: { id: input.submissionId, liveId: input.liveId, verificationStatus: "VERIFIED", form: { vendorId: input.vendorId } },
      select: { id: true, name: true, email: true, verificationStatus: true },
    }),
  ]);
  return live && rule && submission
    ? { live: live as NotificationLive, rule: rule as NotificationRule, submission: submission as VerifiedSubmission }
    : null;
}

export async function ensureLiveNotificationDelivery(input: {
  vendorId: string;
  liveId: string;
  ruleId: string;
  submissionId: string;
}, now = new Date(), options: { scheduleFuture?: boolean } = {}) {
  const db = getDb();
  const scheduleFuture = options.scheduleFuture ?? false;
  try {
    return await db.$transaction(async (tx) => {
      const current = await readCurrentNotificationSnapshot(tx, input);
      if (!current) return { status: "not_configured" as const };
      const data = await buildDeliveryData(tx, { ...current, now, scheduleFuture });
      if (!data) return { status: "not_due" as const };
      const prefix = liveNotificationIdempotencyPrefix(data.trigger as LiveNotificationDeliveryTrigger, current.rule.id);
      const alreadySent = await tx.emailDelivery.findFirst({
        where: {
          vendorId: input.vendorId,
          sourceLiveId: input.liveId,
          sourceFormSubmissionId: input.submissionId,
          idempotencyKey: { startsWith: prefix },
          status: "sent",
        },
        select: { id: true },
      });
      if (alreadySent) return { status: "already_sent" as const };
      await tx.emailDelivery.updateMany({
        where: {
          vendorId: input.vendorId,
          sourceLiveId: input.liveId,
          sourceFormSubmissionId: input.submissionId,
          id: { not: data.id },
          idempotencyKey: { startsWith: prefix },
          status: { in: ["queued", "failed"] },
        },
        data: { status: "superseded", nextAttemptAt: null, claimedAt: null, lastErrorCode: "config_superseded" },
      });
      const delivery = await tx.emailDelivery.create({ data, select: { id: true, status: true, nextAttemptAt: true } });
      return { status: delivery.status === "suppressed" ? "suppressed" as const : "queued" as const, deliveryId: delivery.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    return db.$transaction(async (tx) => {
      const current = await readCurrentNotificationSnapshot(tx, input);
      if (!current) return { status: "not_configured" as const };
      const data = await buildDeliveryData(tx, { ...current, now, scheduleFuture });
      if (!data) return { status: "not_due" as const };
      const existing = await tx.emailDelivery.findUnique({
        where: { id: data.id },
        select: { id: true, status: true, updatedAt: true },
      });
      if (!existing) throw error;
      if (existing.status === "sent") return { status: "already_sent" as const, deliveryId: existing.id };
      if (existing.status !== "superseded") return { status: "duplicate" as const, deliveryId: existing.id };
      const reactivated = await tx.emailDelivery.updateMany({
        where: { id: existing.id, status: "superseded", updatedAt: existing.updatedAt },
        data: {
          sourceTemplateId: data.sourceTemplateId,
          payloadEncryptedEnvelope: data.payloadEncryptedEnvelope,
          recipientHash: data.recipientHash,
          recipientMaskedEmail: data.recipientMaskedEmail,
          idempotencyKey: data.idempotencyKey,
          status: data.status,
          attemptCount: 0,
          nextAttemptAt: data.nextAttemptAt,
          claimedAt: null,
          failedAt: null,
          lastErrorCode: data.lastErrorCode,
        },
      });
      return reactivated.count === 1
        ? { status: data.status === "suppressed" ? "suppressed" as const : "reactivated" as const, deliveryId: existing.id }
        : { status: "duplicate" as const, deliveryId: existing.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function rotatingSkip(total: number, limit: number, now: Date) {
  if (total <= limit) return 0;
  const pages = Math.ceil(total / limit);
  return (Math.floor(now.getTime() / 60_000) % pages) * limit;
}

const DEFAULT_NOTIFICATION_SCAN_BUDGET = 5_000;
const DEFAULT_DUE_RULE_SCAN_LIMIT = 250;
const WRITING_NOTIFICATION_STATUSES = new Set(["queued", "reactivated", "suppressed"]);

type MaterializationRule = {
  id: string;
  trigger: string;
  liveId: string;
  vendorId: string;
  offsetMinutes: number;
};

type MaterializationRuleState = {
  rule: MaterializationRule;
  submissionWhere: Prisma.FormSubmissionWhereInput;
  submissionCount: number;
  targetCount: number;
  start: number;
  processed: number;
  buffer: Array<{ id: string }>;
  bufferIndex: number;
  exhausted: boolean;
};

async function prepareMaterializationRules(
  db: ReturnType<typeof getDb>,
  rules: MaterializationRule[],
  now: Date,
  includeFuture: boolean,
  maxRecipients: number,
) {
  const prepared: Array<{ dueAt: Date; state: MaterializationRuleState }> = [];
  for (const rule of rules) {
    const live = await db.live.findFirst({
      where: { id: rule.liveId, vendorId: rule.vendorId },
      select: { status: true, scheduledAt: true, startedAt: true, endedAt: true, liveReminderTemplateId: true },
    });
    if (!live || (rule.trigger === "before_live" && live.liveReminderTemplateId !== null)) continue;
    const dueAt = resolveLiveNotificationDueAt({
      trigger: rule.trigger as LiveNotificationDeliveryTrigger,
      scheduledAt: live.scheduledAt,
      startedAt: live.startedAt,
      offsetMinutes: rule.offsetMinutes,
    });
    const lifecycleEligible = rule.trigger === "before_live"
      ? live.status === "scheduled" && !live.startedAt && now < live.scheduledAt
      : live.status === "live" && Boolean(live.startedAt) && !live.endedAt;
    if (!dueAt || !lifecycleEligible || (!includeFuture && dueAt > now)) continue;
    const submissionWhere: Prisma.FormSubmissionWhereInput = {
      liveId: rule.liveId,
      verificationStatus: "VERIFIED",
      form: { vendorId: rule.vendorId },
    };
    const submissionCount = await db.formSubmission.count({ where: submissionWhere });
    prepared.push({
      dueAt,
      state: {
        rule,
        submissionWhere,
        submissionCount,
        targetCount: Math.min(submissionCount, maxRecipients),
        start: rotatingSkip(submissionCount, maxRecipients, now),
        processed: 0,
        buffer: [],
        bufferIndex: 0,
        exhausted: submissionCount === 0,
      },
    });
  }
  prepared.sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime() || left.state.rule.id.localeCompare(right.state.rule.id));
  return prepared.map(({ state }) => state);
}

async function nextSubmissionForRule(
  db: ReturnType<typeof getDb>,
  state: MaterializationRuleState,
  recipientLimit: number,
) {
  if (state.exhausted) return null;
  if (state.bufferIndex >= state.buffer.length) {
    const offset = (state.start + state.processed) % state.submissionCount;
    const take = Math.min(recipientLimit, state.targetCount - state.processed, state.submissionCount - offset);
    if (take <= 0) {
      state.exhausted = true;
      return null;
    }
    state.buffer = await db.formSubmission.findMany({
      where: state.submissionWhere,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: offset,
      take,
      select: { id: true },
    });
    state.bufferIndex = 0;
    if (state.buffer.length === 0) {
      state.exhausted = true;
      return null;
    }
  }
  const submission = state.buffer[state.bufferIndex];
  state.bufferIndex += 1;
  state.processed += 1;
  if (state.processed >= state.targetCount) state.exhausted = true;
  return submission ?? null;
}

export async function processDueLiveNotifications(options: {
  now?: Date;
  ruleLimit?: number;
  recipientLimitPerRule?: number;
  maxRecipientsPerRule?: number;
  vendorId?: string;
  ruleIds?: string[];
  includeFuture?: boolean;
  writeBudget?: number;
  scanBudget?: number;
  dueRuleScanLimit?: number;
} = {}) {
  const db = getDb();
  const now = options.now ?? new Date();
  const ruleLimit = Math.max(1, Math.min(50, options.ruleLimit ?? 20));
  const recipientLimit = Math.max(1, Math.min(250, options.recipientLimitPerRule ?? 100));
  const maxRecipients = Math.max(recipientLimit, Math.min(5_000, options.maxRecipientsPerRule ?? 1_000));
  const includeFuture = options.includeFuture ?? true;
  const writeBudget = Math.max(1, Math.min(5_000, options.writeBudget ?? 1_000));
  const scanBudget = Math.max(1, Math.min(25_000, options.scanBudget ?? DEFAULT_NOTIFICATION_SCAN_BUDGET));
  const dueRuleScanLimit = Math.max(ruleLimit, Math.min(1_000, options.dueRuleScanLimit ?? DEFAULT_DUE_RULE_SCAN_LIMIT));
  const where: Prisma.LiveNotificationRuleWhereInput = {
    ...(options.vendorId ? { vendorId: options.vendorId } : {}),
    ...(options.ruleIds?.length ? { id: { in: [...new Set(options.ruleIds)] } } : {}),
    trigger: { in: [...LIVE_NOTIFICATION_DELIVERY_TRIGGERS] },
    isActive: true,
  };
  const count = await db.liveNotificationRule.count({ where });
  const selectedRuleLimit = includeFuture || options.ruleIds?.length ? ruleLimit : dueRuleScanLimit;
  const rules = await db.liveNotificationRule.findMany({
    where,
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    skip: options.ruleIds?.length ? 0 : rotatingSkip(count, selectedRuleLimit, now),
    take: selectedRuleLimit,
    select: { id: true, trigger: true, liveId: true, vendorId: true, offsetMinutes: true },
  });
  const results: Array<{ status: string }> = [];
  const states = await prepareMaterializationRules(db, rules, now, includeFuture, maxRecipients);
  const stateStart = rotatingSkip(states.length, 1, now);
  const rotatingStates = [...states.slice(stateStart), ...states.slice(0, stateStart)];
  let scanned = 0;
  let writes = 0;
  while (scanned < scanBudget && writes < writeBudget && rotatingStates.some((state) => !state.exhausted)) {
    for (const state of rotatingStates) {
      if (scanned >= scanBudget || writes >= writeBudget) break;
      const submission = await nextSubmissionForRule(db, state, recipientLimit);
      if (!submission) continue;
      const result = await ensureLiveNotificationDelivery(
        { vendorId: state.rule.vendorId, liveId: state.rule.liveId, ruleId: state.rule.id, submissionId: submission.id },
        now,
        { scheduleFuture: true },
      );
      results.push({ status: result.status });
      scanned += 1;
      if (WRITING_NOTIFICATION_STATUSES.has(result.status)) writes += 1;
    }
  }
  return results;
}

export async function materializeLiveNotificationRules(input: {
  vendorId: string;
  liveId: string;
  ruleIds: string[];
  now?: Date;
  writeBudget?: number;
}) {
  if (input.ruleIds.length === 0) return [];
  return processDueLiveNotifications({
    now: input.now,
    vendorId: input.vendorId,
    ruleIds: input.ruleIds,
    ruleLimit: Math.min(50, input.ruleIds.length),
    includeFuture: true,
    writeBudget: input.writeBudget ?? 1_000,
  });
}

export async function materializeLiveNotificationsForSubmission(input: {
  vendorId: string;
  liveId: string;
  submissionId: string;
  now?: Date;
}) {
  const db = getDb();
  const rules = await db.liveNotificationRule.findMany({
    where: { vendorId: input.vendorId, liveId: input.liveId, trigger: "before_live", isActive: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    take: 3,
    select: { id: true },
  });
  const results: Array<{ status: string }> = [];
  for (const rule of rules) {
    const result = await ensureLiveNotificationDelivery(
      { vendorId: input.vendorId, liveId: input.liveId, ruleId: rule.id, submissionId: input.submissionId },
      input.now ?? new Date(),
      { scheduleFuture: true },
    );
    results.push({ status: result.status });
  }
  return results;
}

export async function isCurrentLiveNotificationDeliverySnapshot(
  delivery: { id: string; vendorId: string; sourceLiveId: string | null; sourceFormSubmissionId: string | null; trigger: string; idempotencyKey?: string },
  now = new Date(),
  db: NotificationSnapshotDatabase = getDb(),
) {
  if (!LIVE_NOTIFICATION_DELIVERY_TRIGGERS.includes(delivery.trigger as LiveNotificationDeliveryTrigger)) return true;
  const identity = delivery.idempotencyKey ? liveNotificationIdentityFromKey(delivery.idempotencyKey) : null;
  if (!identity || identity.trigger !== delivery.trigger || !delivery.sourceLiveId || !delivery.sourceFormSubmissionId) return false;
  const current = await readCurrentNotificationSnapshot(db, {
    vendorId: delivery.vendorId,
    liveId: delivery.sourceLiveId,
    ruleId: identity.ruleId,
    submissionId: delivery.sourceFormSubmissionId,
  });
  if (!current) return false;
  const snapshot = deliverySnapshot({ ...current, now });
  if (!snapshot || snapshot.dueAt > now || snapshot.deliveryId !== delivery.id) return false;
  const normalizedEmail = normalizeBlacklistIdentifier("email", current.submission.email);
  if (!normalizedEmail) return false;
  const blacklist = await db.blacklist.findFirst({
    where: { vendorId: delivery.vendorId, identifierType: "email", identifier: normalizedEmail, isActive: true, unblockedAt: null },
    select: { id: true },
  });
  return !blacklist;
}

export async function supersedeLiveNotificationDeliveriesForLifecycle(
  tx: Pick<Prisma.TransactionClient, "emailDelivery">,
  input: { vendorId: string; liveId: string; triggers: LiveNotificationDeliveryTrigger[] },
) {
  return tx.emailDelivery.updateMany({
    where: {
      vendorId: input.vendorId,
      sourceLiveId: input.liveId,
      trigger: { in: input.triggers },
      status: { in: ["queued", "failed"] },
    },
    data: { status: "superseded", nextAttemptAt: null, claimedAt: null, lastErrorCode: "lifecycle_superseded" },
  });
}

export async function supersedeLiveNotificationDeliveriesForTemplate(
  tx: Pick<Prisma.TransactionClient, "liveNotificationRule" | "emailDelivery">,
  input: { vendorId: string; templateId: string },
) {
  const rules = await tx.liveNotificationRule.findMany({
    where: { vendorId: input.vendorId, messageTemplateId: input.templateId, trigger: { in: [...LIVE_NOTIFICATION_DELIVERY_TRIGGERS] } },
    select: { id: true, liveId: true, trigger: true },
  });
  let superseded = 0;
  for (const rule of rules) {
    const result = await tx.emailDelivery.updateMany({
      where: {
        vendorId: input.vendorId,
        sourceLiveId: rule.liveId,
        trigger: rule.trigger,
        idempotencyKey: { startsWith: liveNotificationIdempotencyPrefix(rule.trigger as LiveNotificationDeliveryTrigger, rule.id) },
        status: { in: ["queued", "failed"] },
      },
      data: { status: "superseded", nextAttemptAt: null, claimedAt: null, lastErrorCode: "config_superseded" },
    });
    superseded += result.count;
  }
  return superseded;
}

class CutoverPreconditionError extends Error {}

export async function processLegacyReminderCutovers(options: { now?: Date; limit?: number; vendorId?: string } = {}) {
  const db = getDb();
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(25, options.limit ?? 5));
  const candidateWhere: Prisma.LiveWhereInput = {
    ...(options.vendorId ? { vendorId: options.vendorId } : {}),
    liveReminderTemplateId: { not: null },
    status: "scheduled",
    startedAt: null,
    scheduledAt: { gt: now },
  };
  const candidateCount = await db.live.count({ where: candidateWhere });
  const candidates = await db.live.findMany({
    where: candidateWhere,
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    skip: rotatingSkip(candidateCount, limit, now),
    take: limit,
    select: { id: true, vendorId: true },
  });
  const results: Array<{ status: string }> = [];
  for (const candidate of candidates) {
    try {
      const status = await db.$transaction(async (tx) => {
        const live = await tx.live.findFirst({
          where: { id: candidate.id, vendorId: candidate.vendorId, status: "scheduled", startedAt: null, scheduledAt: { gt: now }, liveReminderTemplateId: { not: null } },
          select: {
            id: true, vendorId: true, slug: true, title: true, status: true, scheduledAt: true, startedAt: true, endedAt: true,
            liveReminderTemplateId: true, liveReminderOffsetMinutes: true,
            vendor: { select: { name: true, senderName: true, supportEmail: true, contactUrl: true } },
            notificationRules: { where: { trigger: "before_live", isActive: true }, include: { messageTemplate: true } },
          },
        });
        if (!live?.liveReminderTemplateId) throw new CutoverPreconditionError("precondition");
        const equivalent = live.notificationRules.find((rule) => rule.messageTemplateId === live.liveReminderTemplateId && rule.offsetMinutes === live.liveReminderOffsetMinutes);
        if (!equivalent) throw new CutoverPreconditionError("no_equivalent_rule");
        const delivered = await tx.emailDelivery.count({
          where: { vendorId: live.vendorId, sourceLiveId: live.id, trigger: "live_reminder", status: { in: ["sent", "sending"] } },
        });
        if (delivered > 0) throw new CutoverPreconditionError("legacy_sent_or_sending");
        const submissions = await tx.formSubmission.findMany({
          where: { liveId: live.id, verificationStatus: "VERIFIED", form: { vendorId: live.vendorId } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: CUTOVER_RECIPIENT_LIMIT + 1,
          select: { id: true, name: true, email: true, verificationStatus: true },
        });
        if (submissions.length > CUTOVER_RECIPIENT_LIMIT) throw new CutoverPreconditionError("capacity");
        const prefix = liveNotificationIdempotencyPrefix("before_live", equivalent.id);
        const conflict = await tx.emailDelivery.findFirst({
          where: { vendorId: live.vendorId, sourceLiveId: live.id, idempotencyKey: { startsWith: prefix } },
          select: { id: true },
        });
        if (conflict) throw new CutoverPreconditionError("duplicate_conflict");
        for (const submission of submissions) {
          const data = await buildDeliveryData(tx, {
            live: live as NotificationLive,
            rule: equivalent as NotificationRule,
            submission: submission as VerifiedSubmission,
            now,
            scheduleFuture: true,
          });
          if (!data) throw new CutoverPreconditionError("invalid_snapshot");
          await tx.emailDelivery.create({ data });
        }
        await tx.emailDelivery.updateMany({
          where: {
            vendorId: live.vendorId,
            sourceLiveId: live.id,
            trigger: "live_reminder",
            idempotencyKey: { startsWith: "live-reminder/" },
            status: { in: ["queued", "failed"] },
          },
          data: { status: "superseded", nextAttemptAt: null, claimedAt: null, lastErrorCode: "cutover_superseded" },
        });
        const cleared = await tx.live.updateMany({
          where: {
            id: live.id,
            vendorId: live.vendorId,
            liveReminderTemplateId: live.liveReminderTemplateId,
            liveReminderOffsetMinutes: live.liveReminderOffsetMinutes,
            status: "scheduled",
            startedAt: null,
            scheduledAt: live.scheduledAt,
          },
          data: { liveReminderTemplateId: null },
        });
        if (cleared.count !== 1) throw new CutoverPreconditionError("precondition");
        return "cutover";
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      results.push({ status });
    } catch (error) {
      if (error instanceof CutoverPreconditionError) results.push({ status: error.message });
      else if (isUniqueConflict(error)) results.push({ status: "duplicate_conflict" });
      else {
        try {
          captureOperationalError(error, { source: "live_notification_cutover", operation: "cutover", status: "failed" });
        } catch {
          // Monitoring must not change the fail-closed cutover result.
        }
        results.push({ status: "failed" });
      }
    }
  }
  return results;
}
