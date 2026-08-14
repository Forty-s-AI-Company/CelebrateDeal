import type { Prisma, PrismaClient } from "@prisma/client";
import { getDb } from "@/lib/db";
import { createEmailRecipientHash } from "@/lib/email-delivery-pii";
import { isCurrentEmailDeliverySnapshot } from "@/lib/email-delivery";
import { EMAIL_DELIVERY_QUERY_MAX_LENGTH } from "@/lib/email-delivery-operations-contract";
import { formatDateTime } from "@/lib/format";

export const EMAIL_DELIVERY_PAGE_SIZE = 25;
export { EMAIL_DELIVERY_QUERY_MAX_LENGTH };

export type EmailDeliveryStatusFilter =
  | "ALL"
  | "ATTENTION"
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "exhausted"
  | "suppressed"
  | "superseded";

export type EmailDeliveryTriggerFilter =
  | "ALL"
  | "registration_confirmed"
  | "form_submission_verification"
  | "live_reminder";

export type EmailDeliverySearchCriteria = {
  query: string;
  status: EmailDeliveryStatusFilter;
  trigger: EmailDeliveryTriggerFilter;
  page: number;
};

export type EmailDeliveryListItem = {
  id: string;
  recipientMaskedEmail: string;
  status: string;
  trigger: string;
  attemptCount: number;
  maxAttempts: number;
  manualRetryCount: number;
  createdAtLabel: string;
  sentAtLabel: string | null;
  nextAttemptAtLabel: string | null;
  lastManualRetryAtLabel: string | null;
  lastErrorCode: string | null;
  canRetry: boolean;
};

export type EmailDeliverySearchResult = {
  criteria: EmailDeliverySearchCriteria;
  items: EmailDeliveryListItem[];
  counts: Record<string, number>;
  totalItems: number;
  page: number;
  totalPages: number;
  pageSize: number;
};

export type EmailDeliverySearchParseResult =
  | { success: true; data: EmailDeliverySearchCriteria; retryDeliveryId: string | null }
  | { success: false; message: string };

type EmailDeliverySearchDatabase = Pick<PrismaClient, "emailDelivery" | "emailSuppression">;

const DELIVERY_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const STATUS_FILTERS = new Set<EmailDeliveryStatusFilter>([
  "ALL", "ATTENTION", "queued", "sending", "sent", "failed", "exhausted", "suppressed", "superseded",
]);
const TRIGGER_FILTERS = new Set<EmailDeliveryTriggerFilter>([
  "ALL", "registration_confirmed", "form_submission_verification", "live_reminder",
]);

function readText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function validDeliveryId(value: string) {
  return DELIVERY_ID_PATTERN.test(value);
}

export function parseEmailDeliverySearchInput(formData: FormData): EmailDeliverySearchParseResult {
  const operation = readText(formData, "operation");
  const reset = operation === "reset";
  const query = reset ? "" : readText(formData, "query").trim();
  if (query.length > EMAIL_DELIVERY_QUERY_MAX_LENGTH) {
    return { success: false, message: `搜尋內容不可超過 ${EMAIL_DELIVERY_QUERY_MAX_LENGTH} 個字。` };
  }
  if (query && (query.includes("@") ? !EMAIL_PATTERN.test(query) : !validDeliveryId(query))) {
    return { success: false, message: "請輸入完整收件 Email 或完整寄送編號。" };
  }

  const statusRaw = reset ? "ALL" : readText(formData, "status");
  const triggerRaw = reset ? "ALL" : readText(formData, "trigger");
  const status = STATUS_FILTERS.has(statusRaw as EmailDeliveryStatusFilter)
    ? statusRaw as EmailDeliveryStatusFilter
    : "ALL";
  const trigger = TRIGGER_FILTERS.has(triggerRaw as EmailDeliveryTriggerFilter)
    ? triggerRaw as EmailDeliveryTriggerFilter
    : "ALL";

  const retryOperation = operation.startsWith("retry:");
  const pageRaw = reset ? "1" : readText(formData, retryOperation ? "currentPage" : "page");
  const parsedPage = Number.parseInt(pageRaw, 10);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const retryDeliveryId = retryOperation ? operation.slice("retry:".length) : null;
  if (retryDeliveryId !== null && !validDeliveryId(retryDeliveryId)) {
    return { success: false, message: "找不到要重新排程的寄送紀錄。" };
  }

  return { success: true, data: { query, status, trigger, page }, retryDeliveryId };
}

export function buildEmailDeliveryWhere(
  vendorId: string,
  criteria: EmailDeliverySearchCriteria,
): Prisma.EmailDeliveryWhereInput {
  const where: Prisma.EmailDeliveryWhereInput = { vendorId };
  if (criteria.query) {
    if (criteria.query.includes("@")) {
      where.recipientHash = createEmailRecipientHash(criteria.query, vendorId);
    } else {
      where.id = criteria.query;
    }
  }
  if (criteria.status === "ATTENTION") where.status = { in: ["failed", "exhausted"] };
  else if (criteria.status !== "ALL") where.status = criteria.status;
  if (criteria.trigger !== "ALL") where.trigger = criteria.trigger;
  return where;
}

export async function loadEmailDeliverySearchResult(
  vendorId: string,
  criteria: EmailDeliverySearchCriteria,
  database: EmailDeliverySearchDatabase = getDb(),
): Promise<EmailDeliverySearchResult> {
  const where = buildEmailDeliveryWhere(vendorId, criteria);
  const [totalItems, grouped, activeSuppressionCount] = await Promise.all([
    database.emailDelivery.count({ where }),
    database.emailDelivery.groupBy({
      by: ["status"],
      where: { vendorId },
      _count: { _all: true },
    }),
    database.emailSuppression.count({
      where: { vendorId, resubscribedAt: null },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalItems / EMAIL_DELIVERY_PAGE_SIZE));
  const page = Math.min(criteria.page, totalPages);
  const deliveries = await database.emailDelivery.findMany({
    where,
    select: {
      id: true,
      recipientMaskedEmail: true,
      status: true,
      trigger: true,
      attemptCount: true,
      maxAttempts: true,
      manualRetryCount: true,
      createdAt: true,
      sentAt: true,
      nextAttemptAt: true,
      lastManualRetryAt: true,
      lastErrorCode: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * EMAIL_DELIVERY_PAGE_SIZE,
    take: EMAIL_DELIVERY_PAGE_SIZE,
  });

  return {
    criteria: { ...criteria, page },
    items: deliveries.map((delivery) => ({
      id: delivery.id,
      recipientMaskedEmail: delivery.recipientMaskedEmail,
      status: delivery.status,
      trigger: delivery.trigger,
      attemptCount: delivery.attemptCount,
      maxAttempts: delivery.maxAttempts,
      manualRetryCount: delivery.manualRetryCount,
      createdAtLabel: formatDateTime(delivery.createdAt),
      sentAtLabel: delivery.sentAt ? formatDateTime(delivery.sentAt) : null,
      nextAttemptAtLabel: delivery.nextAttemptAt ? formatDateTime(delivery.nextAttemptAt) : null,
      lastManualRetryAtLabel: delivery.lastManualRetryAt ? formatDateTime(delivery.lastManualRetryAt) : null,
      lastErrorCode: delivery.lastErrorCode,
      canRetry: canManuallyRequeueEmailDelivery(delivery.status, delivery.lastErrorCode),
    })),
    counts: {
      ...Object.fromEntries(grouped.map((entry) => [entry.status, entry._count._all])),
      activeSuppressions: activeSuppressionCount,
    },
    totalItems,
    page,
    totalPages,
    pageSize: EMAIL_DELIVERY_PAGE_SIZE,
  };
}

export type RequeueEmailDeliveryResult =
  | { status: "requeued"; previousStatus: string }
  | { status: "missing" | "ineligible" | "stale" | "conflict" };

export function canManuallyRequeueEmailDelivery(status: string, lastErrorCode: string | null) {
  if (status === "failed") return true;
  if (status !== "exhausted") return false;
  // provider_rejected can represent either a permanent 4xx or a transient
  // provider response. The sanitized row does not retain enough detail to
  // distinguish them, so exhausted provider rejections stay fail-closed.
  return lastErrorCode !== "provider_rejected"
    && lastErrorCode !== "recipient_suppressed"
    && lastErrorCode !== "config_superseded"
    && lastErrorCode !== "verification_superseded";
}

export async function requeueEmailDelivery(input: {
  vendorId: string;
  deliveryId: string;
  actorId: string;
  actorLabel: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  now?: Date;
  database?: PrismaClient;
}): Promise<RequeueEmailDeliveryResult> {
  const database = input.database ?? getDb();
  const now = input.now ?? new Date();
  return database.$transaction(async (tx) => {
    const candidate = await tx.emailDelivery.findFirst({
      where: { id: input.deliveryId, vendorId: input.vendorId },
      select: {
        id: true,
        vendorId: true,
        sourceLiveId: true,
        sourceFormSubmissionId: true,
        trigger: true,
        status: true,
        attemptCount: true,
        maxAttempts: true,
        lastErrorCode: true,
        updatedAt: true,
      },
    });
    if (!candidate) return { status: "missing" as const };
    if (!canManuallyRequeueEmailDelivery(candidate.status, candidate.lastErrorCode)) {
      return { status: "ineligible" as const };
    }

    const current = await isCurrentEmailDeliverySnapshot(candidate, now, tx);
    if (!current) {
      const stale = await tx.emailDelivery.updateMany({
        where: {
          id: candidate.id,
          vendorId: input.vendorId,
          status: candidate.status,
          updatedAt: candidate.updatedAt,
        },
        data: {
          status: "superseded",
          nextAttemptAt: null,
          claimedAt: null,
          lastErrorCode: candidate.trigger === "form_submission_verification"
            ? "verification_superseded"
            : "config_superseded",
        },
      });
      if (stale.count !== 1) return { status: "conflict" as const };
      await tx.auditLog.create({
        data: {
          vendorId: input.vendorId,
          actorId: input.actorId,
          actorLabel: input.actorLabel,
          action: "email_delivery_retry_rejected_stale",
          targetType: "EmailDelivery",
          targetId: candidate.id,
          before: { status: candidate.status, attemptCount: candidate.attemptCount, errorCode: candidate.lastErrorCode },
          after: { status: "superseded" },
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
      return { status: "stale" as const };
    }

    const resetAttempts = candidate.status === "exhausted" || candidate.attemptCount >= candidate.maxAttempts;
    const updated = await tx.emailDelivery.updateMany({
      where: {
        id: candidate.id,
        vendorId: input.vendorId,
        status: candidate.status,
        updatedAt: candidate.updatedAt,
      },
      data: {
        status: "queued",
        attemptCount: resetAttempts ? 0 : candidate.attemptCount,
        nextAttemptAt: now,
        claimedAt: null,
        failedAt: null,
        lastErrorCode: null,
        manualRetryCount: { increment: 1 },
        lastManualRetryAt: now,
      },
    });
    if (updated.count !== 1) return { status: "conflict" as const };

    await tx.auditLog.create({
      data: {
        vendorId: input.vendorId,
        actorId: input.actorId,
        actorLabel: input.actorLabel,
        action: "email_delivery_requeued",
        targetType: "EmailDelivery",
        targetId: candidate.id,
        before: {
          status: candidate.status,
          attemptCount: candidate.attemptCount,
          errorCode: candidate.lastErrorCode,
        },
        after: {
          status: "queued",
          attemptCount: resetAttempts ? 0 : candidate.attemptCount,
          scheduledAt: now.toISOString(),
        },
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
    return { status: "requeued" as const, previousStatus: candidate.status };
  }, { isolationLevel: "Serializable" });
}
