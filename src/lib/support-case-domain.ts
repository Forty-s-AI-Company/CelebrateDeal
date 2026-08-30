import { randomBytes, randomUUID } from "node:crypto";
import type {
  Prisma,
  SupportCaseCategory,
  SupportCasePriority,
  SupportCaseStatus,
  SupportRefundHandoffStatus,
} from "@prisma/client";

import { protectSupportCaseContent } from "@/lib/support-case-pii";

export const SUPPORT_CASE_CATEGORIES = ["payment", "refund", "fulfillment", "access", "general"] as const;
export const SUPPORT_CASE_PRIORITIES = ["p0", "p1", "p2"] as const;
export const SUPPORT_CASE_STATUSES = ["open", "in_progress", "waiting_customer", "waiting_finance", "resolved", "closed"] as const;
export const SUPPORT_REFUND_HANDOFF_STATUSES = ["requested", "reviewing", "declined", "completed"] as const;

type SupportCaseDomainErrorCode =
  | "invalid_actor"
  | "buyer_access_unavailable"
  | "order_unavailable"
  | "case_unavailable"
  | "case_conflict"
  | "invalid_content"
  | "invalid_transition"
  | "refund_unavailable"
  | "refund_conflict";

export class SupportCaseDomainError extends Error {
  constructor(readonly code: SupportCaseDomainErrorCode) {
    super(code);
    this.name = "SupportCaseDomainError";
  }
}

const transitions: Record<SupportCaseStatus, readonly SupportCaseStatus[]> = {
  open: ["in_progress", "waiting_customer", "waiting_finance", "resolved"],
  in_progress: ["waiting_customer", "waiting_finance", "resolved"],
  waiting_customer: ["in_progress", "resolved"],
  waiting_finance: ["in_progress", "resolved"],
  resolved: ["in_progress", "closed"],
  closed: [],
};

const SUPPORT_MEMBER_ROLES = ["owner", "admin", "support"] as const;

function validatedSupportContent(value: string) {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 4_000) {
    throw new SupportCaseDomainError("invalid_content");
  }
  return normalized;
}

export function supportResponseDueAt(priority: SupportCasePriority, now: Date) {
  const milliseconds = priority === "p0"
    ? 15 * 60 * 1000
    : priority === "p1"
      ? 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + milliseconds);
}

function caseNumber(now: Date) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `SC-${date}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

async function activeMember(
  tx: Prisma.TransactionClient,
  vendorId: string,
  memberId: string,
) {
  return tx.vendorMember.findFirst({
    where: {
      id: memberId,
      vendorId,
      status: "active",
      role: { in: [...SUPPORT_MEMBER_ROLES] },
    },
    select: { id: true },
  });
}

export async function createSupportCase(
  tx: Prisma.TransactionClient,
  input: {
    vendorId: string;
    orderId: string;
    intakeKey: string;
    category: SupportCaseCategory;
    priority: SupportCasePriority;
    summary: string;
    actorMemberId: string;
    now?: Date;
  },
) {
  const [order, actor] = await Promise.all([
    tx.commerceOrder.findFirst({
      where: { id: input.orderId, vendorId: input.vendorId },
      select: { id: true },
    }),
    activeMember(tx, input.vendorId, input.actorMemberId),
  ]);
  if (!order) throw new SupportCaseDomainError("order_unavailable");
  if (!actor) throw new SupportCaseDomainError("invalid_actor");

  const now = input.now ?? new Date();
  const supportCaseId = randomUUID();
  const eventId = randomUUID();
  const encryptedSummary = protectSupportCaseContent(input.summary, {
    vendorId: input.vendorId,
    supportCaseId,
    recordId: eventId,
    kind: "initial_summary",
  });
  const supportCase = await tx.supportCase.create({
    data: {
      id: supportCaseId,
      vendorId: input.vendorId,
      orderId: order.id,
      caseNumber: caseNumber(now),
      intakeKey: input.intakeKey,
      category: input.category,
      priority: input.priority,
      status: "open",
      revision: 1,
      createdByMemberId: actor.id,
      assignedMemberId: actor.id,
      responseDueAt: supportResponseDueAt(input.priority, now),
      createdAt: now,
      updatedAt: now,
    },
  });
  await tx.supportCaseEvent.create({
    data: {
      id: eventId,
      vendorId: input.vendorId,
      supportCaseId,
      dedupKey: `created:${input.intakeKey}`,
      eventType: "created",
      audience: "internal",
      actorMemberId: actor.id,
      payloadEncryptedEnvelope: encryptedSummary,
      sanitizedData: {
        orderId: order.id,
        category: input.category,
        priority: input.priority,
      },
      occurredAt: now,
      createdAt: now,
    },
  });
  return supportCase;
}

export async function addSupportCaseNote(
  tx: Prisma.TransactionClient,
  input: {
    vendorId: string;
    supportCaseId: string;
    expectedRevision: number;
    dedupKey: string;
    note: string;
    actorMemberId: string;
    now?: Date;
  },
) {
  const note = validatedSupportContent(input.note);
  const [supportCase, actor] = await Promise.all([
    tx.supportCase.findFirst({
      where: { id: input.supportCaseId, vendorId: input.vendorId },
      select: { id: true, status: true, revision: true },
    }),
    activeMember(tx, input.vendorId, input.actorMemberId),
  ]);
  if (!supportCase || supportCase.status === "closed") throw new SupportCaseDomainError("case_unavailable");
  if (!actor) throw new SupportCaseDomainError("invalid_actor");

  const duplicate = await tx.supportCaseEvent.findFirst({
    where: {
      vendorId: input.vendorId,
      supportCaseId: supportCase.id,
      dedupKey: input.dedupKey,
    },
    select: { id: true },
  });
  if (duplicate) return supportCase;

  const now = input.now ?? new Date();
  const eventId = randomUUID();
  const encryptedNote = protectSupportCaseContent(note, {
    vendorId: input.vendorId,
    supportCaseId: supportCase.id,
    recordId: eventId,
    kind: "internal_note",
  });
  const nextStatus = supportCase.status === "open" ? "in_progress" : supportCase.status;
  const claimed = await tx.supportCase.updateMany({
    where: {
      id: supportCase.id,
      vendorId: input.vendorId,
      revision: input.expectedRevision,
      status: supportCase.status,
    },
    data: {
      status: nextStatus,
      revision: { increment: 1 },
      updatedAt: now,
    },
  });
  if (claimed.count !== 1) throw new SupportCaseDomainError("case_conflict");

  await tx.supportCaseEvent.create({
    data: {
      id: eventId,
      vendorId: input.vendorId,
      supportCaseId: supportCase.id,
      dedupKey: input.dedupKey,
      eventType: "note_added",
      audience: "internal",
      actorMemberId: actor.id,
      payloadEncryptedEnvelope: encryptedNote,
      sanitizedData: { status: nextStatus },
      occurredAt: now,
      createdAt: now,
    },
  });
  return { ...supportCase, status: nextStatus, revision: supportCase.revision + 1 };
}

export async function assignSupportCase(
  tx: Prisma.TransactionClient,
  input: {
    vendorId: string;
    supportCaseId: string;
    expectedRevision: number;
    assignedMemberId: string;
    actorMemberId: string;
    dedupKey: string;
    now?: Date;
  },
) {
  const [supportCase, actor, assignee] = await Promise.all([
    tx.supportCase.findFirst({
      where: { id: input.supportCaseId, vendorId: input.vendorId },
      select: { id: true, status: true, revision: true, assignedMemberId: true },
    }),
    activeMember(tx, input.vendorId, input.actorMemberId),
    activeMember(tx, input.vendorId, input.assignedMemberId),
  ]);
  if (!supportCase || supportCase.status === "closed") throw new SupportCaseDomainError("case_unavailable");
  if (!actor || !assignee) throw new SupportCaseDomainError("invalid_actor");

  const now = input.now ?? new Date();
  const claimed = await tx.supportCase.updateMany({
    where: {
      id: supportCase.id,
      vendorId: input.vendorId,
      revision: input.expectedRevision,
      assignedMemberId: supportCase.assignedMemberId,
    },
    data: { assignedMemberId: assignee.id, revision: { increment: 1 }, updatedAt: now },
  });
  if (claimed.count !== 1) throw new SupportCaseDomainError("case_conflict");
  await tx.supportCaseEvent.create({
    data: {
      vendorId: input.vendorId,
      supportCaseId: supportCase.id,
      dedupKey: input.dedupKey,
      eventType: "assignment_changed",
      audience: "internal",
      actorMemberId: actor.id,
      sanitizedData: {
        previousAssignedMemberId: supportCase.assignedMemberId,
        assignedMemberId: assignee.id,
      },
      occurredAt: now,
      createdAt: now,
    },
  });
  return { ...supportCase, assignedMemberId: assignee.id, revision: supportCase.revision + 1 };
}

export async function transitionSupportCase(
  tx: Prisma.TransactionClient,
  input: {
    vendorId: string;
    supportCaseId: string;
    expectedRevision: number;
    nextStatus: SupportCaseStatus;
    actorMemberId: string;
    dedupKey: string;
    now?: Date;
  },
) {
  const [supportCase, actor] = await Promise.all([
    tx.supportCase.findFirst({
      where: { id: input.supportCaseId, vendorId: input.vendorId },
      select: {
        id: true,
        status: true,
        revision: true,
        resolvedAt: true,
        refundHandoff: { select: { status: true } },
      },
    }),
    activeMember(tx, input.vendorId, input.actorMemberId),
  ]);
  if (!supportCase) throw new SupportCaseDomainError("case_unavailable");
  if (!actor) throw new SupportCaseDomainError("invalid_actor");
  if (!transitions[supportCase.status].includes(input.nextStatus)) {
    throw new SupportCaseDomainError("invalid_transition");
  }
  const activeRefund = supportCase.refundHandoff
    && ["requested", "reviewing"].includes(supportCase.refundHandoff.status);
  if (input.nextStatus === "waiting_finance" && !supportCase.refundHandoff) {
    throw new SupportCaseDomainError("invalid_transition");
  }
  if ((input.nextStatus === "resolved" || input.nextStatus === "closed") && activeRefund) {
    throw new SupportCaseDomainError("invalid_transition");
  }

  const now = input.now ?? new Date();
  const claimed = await tx.supportCase.updateMany({
    where: {
      id: supportCase.id,
      vendorId: input.vendorId,
      revision: input.expectedRevision,
      status: supportCase.status,
    },
    data: {
      status: input.nextStatus,
      revision: { increment: 1 },
      resolvedAt: input.nextStatus === "resolved"
        ? now
        : input.nextStatus === "closed"
          ? supportCase.resolvedAt ?? now
          : null,
      closedAt: input.nextStatus === "closed" ? now : null,
      updatedAt: now,
    },
  });
  if (claimed.count !== 1) throw new SupportCaseDomainError("case_conflict");
  await tx.supportCaseEvent.create({
    data: {
      vendorId: input.vendorId,
      supportCaseId: supportCase.id,
      dedupKey: input.dedupKey,
      eventType: "status_changed",
      audience: "internal",
      actorMemberId: actor.id,
      sanitizedData: { previousStatus: supportCase.status, status: input.nextStatus },
      occurredAt: now,
      createdAt: now,
    },
  });
  return { ...supportCase, status: input.nextStatus, revision: supportCase.revision + 1 };
}

async function activeBuyerGrant(
  tx: Prisma.TransactionClient,
  input: { grantId: string; vendorId?: string; orderId?: string; now: Date },
) {
  return tx.buyerSupportOrderGrant.findFirst({
    where: {
      id: input.grantId,
      ...(input.vendorId ? { vendorId: input.vendorId } : {}),
      ...(input.orderId ? { orderId: input.orderId } : {}),
      revokedAt: null,
      expiresAt: { gt: input.now },
    },
    select: {
      id: true,
      vendorId: true,
      orderId: true,
      rotationCount: true,
    },
  });
}

export async function createBuyerSupportCase(
  tx: Prisma.TransactionClient,
  input: {
    grantId: string;
    intakeKey: string;
    category: SupportCaseCategory;
    summary: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const grant = await activeBuyerGrant(tx, { grantId: input.grantId, now });
  if (!grant) throw new SupportCaseDomainError("buyer_access_unavailable");

  const priority: SupportCasePriority = input.category === "payment" || input.category === "refund"
    ? "p1"
    : "p2";
  const supportCaseId = randomUUID();
  const eventId = randomUUID();
  const encryptedSummary = protectSupportCaseContent(input.summary, {
    vendorId: grant.vendorId,
    supportCaseId,
    recordId: eventId,
    kind: "initial_summary",
  });
  const supportCase = await tx.supportCase.create({
    data: {
      id: supportCaseId,
      vendorId: grant.vendorId,
      orderId: grant.orderId,
      caseNumber: caseNumber(now),
      intakeKey: input.intakeKey,
      category: input.category,
      priority,
      status: "open",
      revision: 1,
      createdByMemberId: null,
      createdByBuyerGrantId: grant.id,
      assignedMemberId: null,
      responseDueAt: supportResponseDueAt(priority, now),
      createdAt: now,
      updatedAt: now,
    },
  });
  await tx.supportCaseEvent.create({
    data: {
      id: eventId,
      vendorId: grant.vendorId,
      supportCaseId,
      dedupKey: `buyer-created:${input.intakeKey}`,
      eventType: "created",
      audience: "buyer",
      actorBuyerOrderId: grant.orderId,
      actorBuyerGrantId: grant.id,
      payloadEncryptedEnvelope: encryptedSummary,
      sanitizedData: { category: input.category, priority },
      occurredAt: now,
      createdAt: now,
    },
  });
  return { supportCase, grant };
}

export async function addBuyerSupportReply(
  tx: Prisma.TransactionClient,
  input: {
    grantId: string;
    supportCaseId: string;
    expectedRevision: number;
    dedupKey: string;
    message: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const supportCase = await tx.supportCase.findFirst({
    where: { id: input.supportCaseId },
    select: {
      id: true,
      vendorId: true,
      orderId: true,
      status: true,
      revision: true,
      createdByBuyerGrantId: true,
    },
  });
  if (!supportCase || supportCase.status === "closed") {
    throw new SupportCaseDomainError("case_unavailable");
  }
  const grant = await activeBuyerGrant(tx, {
    grantId: input.grantId,
    vendorId: supportCase.vendorId,
    orderId: supportCase.orderId,
    now,
  });
  if (!grant) throw new SupportCaseDomainError("buyer_access_unavailable");

  const buyerVisible = supportCase.createdByBuyerGrantId === grant.id
    || Boolean(await tx.supportCaseEvent.findFirst({
      where: {
        vendorId: supportCase.vendorId,
        supportCaseId: supportCase.id,
        audience: "buyer",
      },
      select: { id: true },
    }));
  if (!buyerVisible) throw new SupportCaseDomainError("case_unavailable");

  const duplicate = await tx.supportCaseEvent.findFirst({
    where: {
      vendorId: supportCase.vendorId,
      supportCaseId: supportCase.id,
      dedupKey: input.dedupKey,
    },
    select: { id: true },
  });
  if (duplicate) return { supportCase, grant };

  const eventId = randomUUID();
  const encryptedMessage = protectSupportCaseContent(input.message, {
    vendorId: supportCase.vendorId,
    supportCaseId: supportCase.id,
    recordId: eventId,
    kind: "buyer_reply",
  });
  const nextStatus = supportCase.status === "waiting_customer" || supportCase.status === "resolved"
    ? "in_progress"
    : supportCase.status;
  const claimed = await tx.supportCase.updateMany({
    where: {
      id: supportCase.id,
      vendorId: supportCase.vendorId,
      revision: input.expectedRevision,
      status: supportCase.status,
    },
    data: {
      status: nextStatus,
      revision: { increment: 1 },
      resolvedAt: supportCase.status === "resolved" ? null : undefined,
      closedAt: null,
      updatedAt: now,
    },
  });
  if (claimed.count !== 1) throw new SupportCaseDomainError("case_conflict");
  await tx.supportCaseEvent.create({
    data: {
      id: eventId,
      vendorId: supportCase.vendorId,
      supportCaseId: supportCase.id,
      dedupKey: input.dedupKey,
      eventType: "buyer_reply_added",
      audience: "buyer",
      actorBuyerOrderId: grant.orderId,
      actorBuyerGrantId: grant.id,
      payloadEncryptedEnvelope: encryptedMessage,
      sanitizedData: { status: nextStatus },
      occurredAt: now,
      createdAt: now,
    },
  });
  return {
    supportCase: { ...supportCase, status: nextStatus, revision: supportCase.revision + 1 },
    grant,
  };
}

export async function addSupportCaseCustomerReply(
  tx: Prisma.TransactionClient,
  input: {
    vendorId: string;
    supportCaseId: string;
    expectedRevision: number;
    dedupKey: string;
    message: string;
    actorMemberId: string;
    now?: Date;
  },
) {
  const [supportCase, actor] = await Promise.all([
    tx.supportCase.findFirst({
      where: { id: input.supportCaseId, vendorId: input.vendorId },
      select: { id: true, status: true, revision: true, firstRespondedAt: true },
    }),
    activeMember(tx, input.vendorId, input.actorMemberId),
  ]);
  if (!supportCase || supportCase.status === "closed") throw new SupportCaseDomainError("case_unavailable");
  if (!actor) throw new SupportCaseDomainError("invalid_actor");

  const duplicate = await tx.supportCaseEvent.findFirst({
    where: { vendorId: input.vendorId, supportCaseId: supportCase.id, dedupKey: input.dedupKey },
    select: { id: true },
  });
  if (duplicate) return supportCase;

  const now = input.now ?? new Date();
  const eventId = randomUUID();
  const encryptedMessage = protectSupportCaseContent(input.message, {
    vendorId: input.vendorId,
    supportCaseId: supportCase.id,
    recordId: eventId,
    kind: "customer_reply",
  });
  const nextStatus = supportCase.status === "waiting_finance" ? "waiting_finance" : "waiting_customer";
  const claimed = await tx.supportCase.updateMany({
    where: {
      id: supportCase.id,
      vendorId: input.vendorId,
      revision: input.expectedRevision,
      status: supportCase.status,
    },
    data: {
      status: nextStatus,
      revision: { increment: 1 },
      firstRespondedAt: supportCase.firstRespondedAt ?? now,
      resolvedAt: supportCase.status === "resolved" ? null : undefined,
      closedAt: null,
      updatedAt: now,
    },
  });
  if (claimed.count !== 1) throw new SupportCaseDomainError("case_conflict");
  await tx.supportCaseEvent.create({
    data: {
      id: eventId,
      vendorId: input.vendorId,
      supportCaseId: supportCase.id,
      dedupKey: input.dedupKey,
      eventType: "customer_reply_added",
      audience: "buyer",
      actorMemberId: actor.id,
      payloadEncryptedEnvelope: encryptedMessage,
      sanitizedData: { status: nextStatus },
      occurredAt: now,
      createdAt: now,
    },
  });
  return { ...supportCase, status: nextStatus, revision: supportCase.revision + 1 };
}

export async function requestSupportRefundHandoff(
  tx: Prisma.TransactionClient,
  input: {
    vendorId: string;
    supportCaseId: string;
    expectedRevision: number;
    requestedAmountCents: number;
    reason: string;
    actorMemberId: string;
    dedupKey: string;
    now?: Date;
  },
) {
  const reason = validatedSupportContent(input.reason);
  const [supportCase, actor] = await Promise.all([
    tx.supportCase.findFirst({
      where: { id: input.supportCaseId, vendorId: input.vendorId },
      select: {
        id: true,
        orderId: true,
        status: true,
        revision: true,
        refundHandoff: { select: { id: true } },
        order: {
          select: {
            id: true,
            status: true,
            paidAmountCents: true,
            refundedAmountCents: true,
            primaryPaymentTransactionId: true,
          },
        },
      },
    }),
    activeMember(tx, input.vendorId, input.actorMemberId),
  ]);
  if (!supportCase || ["resolved", "closed"].includes(supportCase.status)) {
    throw new SupportCaseDomainError("case_unavailable");
  }
  if (!actor) throw new SupportCaseDomainError("invalid_actor");
  const remaining = supportCase.order.paidAmountCents - supportCase.order.refundedAmountCents;
  if (
    supportCase.refundHandoff
    || !["paid", "partially_refunded"].includes(supportCase.order.status)
    || !supportCase.order.primaryPaymentTransactionId
    || !Number.isSafeInteger(input.requestedAmountCents)
    || input.requestedAmountCents <= 0
    || input.requestedAmountCents > remaining
  ) {
    throw new SupportCaseDomainError("refund_unavailable");
  }

  const now = input.now ?? new Date();
  const handoffId = randomUUID();
  const reasonEncryptedEnvelope = protectSupportCaseContent(reason, {
    vendorId: input.vendorId,
    supportCaseId: supportCase.id,
    recordId: handoffId,
    kind: "refund_reason",
  });
  const claimed = await tx.supportCase.updateMany({
    where: {
      id: supportCase.id,
      vendorId: input.vendorId,
      revision: input.expectedRevision,
      status: supportCase.status,
    },
    data: {
      status: "waiting_finance",
      revision: { increment: 1 },
      updatedAt: now,
    },
  });
  if (claimed.count !== 1) throw new SupportCaseDomainError("case_conflict");

  const handoff = await tx.supportRefundHandoff.create({
    data: {
      id: handoffId,
      vendorId: input.vendorId,
      supportCaseId: supportCase.id,
      orderId: supportCase.order.id,
      paymentTransactionId: supportCase.order.primaryPaymentTransactionId,
      requestedByMemberId: actor.id,
      requestedAmountCents: input.requestedAmountCents,
      reasonEncryptedEnvelope,
      status: "requested",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    },
  });
  await Promise.all([
    tx.supportCaseEvent.create({
      data: {
        vendorId: input.vendorId,
        supportCaseId: supportCase.id,
        dedupKey: input.dedupKey,
        eventType: "refund_requested",
        actorMemberId: actor.id,
        sanitizedData: {
          handoffId,
          requestedAmountCents: input.requestedAmountCents,
        },
        occurredAt: now,
        createdAt: now,
      },
    }),
    tx.commerceOrderEvent.create({
      data: {
        vendorId: input.vendorId,
        orderId: supportCase.order.id,
        dedupKey: `support-refund:${handoffId}`,
        eventType: "support_refund_requested",
        actorType: "vendor_member",
        actorId: actor.id,
        sanitizedData: {
          supportCaseId: supportCase.id,
          requestedAmountCents: input.requestedAmountCents,
        },
        occurredAt: now,
        createdAt: now,
      },
    }),
  ]);
  return handoff;
}

type RefundCompletionContext = {
  id: string;
  vendorId: string;
  orderId: string;
  paymentTransactionId: string;
  requestedAmountCents: number;
};

function normalizeCompletedRefundIds(values: readonly string[] | null | undefined) {
  const submitted = [...(values ?? [])];
  const normalized = [...new Set(submitted)].sort();
  const invalid = submitted.length !== normalized.length
    || normalized.length === 0
    || normalized.length > 50
    || normalized.some((id) => id.length < 1 || id.length > 160 || !/^[A-Za-z0-9_-]+$/u.test(id));
  if (invalid) throw new SupportCaseDomainError("refund_unavailable");
  return normalized;
}

async function loadRefundCompletionEvidence(
  tx: Prisma.TransactionClient,
  handoff: RefundCompletionContext,
  completedRefundIds: string[],
) {
  const refunds = await tx.commerceOrderRefund.findMany({
    where: {
      id: { in: completedRefundIds },
      vendorId: handoff.vendorId,
      orderId: handoff.orderId,
      paymentTransactionId: handoff.paymentTransactionId,
      status: "processed",
    },
    select: { id: true, amountCents: true },
  });
  const completedAmountCents = refunds.reduce((sum, refund) => sum + refund.amountCents, 0);
  if (
    refunds.length !== completedRefundIds.length
    || !Number.isSafeInteger(completedAmountCents)
    || completedAmountCents !== handoff.requestedAmountCents
  ) {
    throw new SupportCaseDomainError("refund_unavailable");
  }

  const existingLinks = await tx.supportRefundHandoffRefund.findMany({
    where: {
      vendorId: handoff.vendorId,
      refundId: { in: completedRefundIds },
    },
    select: { refundId: true },
  });
  if (existingLinks.length > 0) throw new SupportCaseDomainError("refund_unavailable");

  return {
    completedAmountCents,
    refunds: [...refunds].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export async function reviewSupportRefundHandoff(
  tx: Prisma.TransactionClient,
  input: {
    handoffId: string;
    expectedRevision: number;
    nextStatus: Exclude<SupportRefundHandoffStatus, "requested">;
    actorUserId: string;
    completedRefundIds?: readonly string[] | null;
    dedupKey: string;
    now?: Date;
  },
) {
  const handoff = await tx.supportRefundHandoff.findUnique({
    where: { id: input.handoffId },
    select: {
      id: true,
      vendorId: true,
      supportCaseId: true,
      orderId: true,
      status: true,
      revision: true,
      paymentTransactionId: true,
      requestedAmountCents: true,
      supportCase: { select: { revision: true, status: true } },
    },
  });
  if (!handoff) throw new SupportCaseDomainError("refund_unavailable");
  const allowed = handoff.status === "requested"
    ? ["reviewing", "declined"]
    : handoff.status === "reviewing"
      ? ["declined", "completed"]
      : [];
  if (!allowed.includes(input.nextStatus)) throw new SupportCaseDomainError("invalid_transition");

  const now = input.now ?? new Date();
  const completedRefundIds = input.nextStatus === "completed"
    ? normalizeCompletedRefundIds(input.completedRefundIds)
    : [];
  const completion = input.nextStatus === "completed"
    ? await loadRefundCompletionEvidence(tx, handoff, completedRefundIds)
    : { completedAmountCents: 0, refunds: [] };
  if (input.nextStatus === "completed") {
    await tx.supportRefundHandoffRefund.createMany({
      data: completion.refunds.map((refund) => ({
        vendorId: handoff.vendorId,
        handoffId: handoff.id,
        orderId: handoff.orderId,
        refundId: refund.id,
        amountCentsSnapshot: refund.amountCents,
        linkedAt: now,
      })),
    });
  }

  const claimed = await tx.supportRefundHandoff.updateMany({
    where: {
      id: handoff.id,
      revision: input.expectedRevision,
      status: handoff.status,
    },
    data: {
      status: input.nextStatus,
      revision: { increment: 1 },
      reviewedByActorId: input.actorUserId,
      reviewedAt: now,
      completedRefundId: completion.refunds[0]?.id ?? null,
      completedAt: input.nextStatus === "completed" ? now : null,
      updatedAt: now,
    },
  });
  if (claimed.count !== 1) throw new SupportCaseDomainError("refund_conflict");

  const nextCaseStatus = input.nextStatus === "completed"
    ? "resolved"
    : input.nextStatus === "declined"
      ? "in_progress"
      : "waiting_finance";
  const caseClaim = await tx.supportCase.updateMany({
    where: {
      id: handoff.supportCaseId,
      vendorId: handoff.vendorId,
      revision: handoff.supportCase.revision,
      status: handoff.supportCase.status,
    },
    data: {
      status: nextCaseStatus,
      revision: { increment: 1 },
      resolvedAt: input.nextStatus === "completed" ? now : null,
      closedAt: null,
      updatedAt: now,
    },
  });
  if (caseClaim.count !== 1) throw new SupportCaseDomainError("case_conflict");

  const eventType = input.nextStatus === "reviewing"
    ? "refund_review_started"
    : input.nextStatus === "declined"
      ? "refund_declined"
      : "refund_completed";
  await Promise.all([
    tx.supportCaseEvent.create({
      data: {
        vendorId: handoff.vendorId,
        supportCaseId: handoff.supportCaseId,
        dedupKey: input.dedupKey,
        eventType,
        actorUserId: input.actorUserId,
        sanitizedData: {
          handoffId: handoff.id,
          status: input.nextStatus,
          completedRefundIds,
          completedAmountCents: input.nextStatus === "completed" ? completion.completedAmountCents : null,
        },
        occurredAt: now,
        createdAt: now,
      },
    }),
    tx.commerceOrderEvent.create({
      data: {
        vendorId: handoff.vendorId,
        orderId: handoff.orderId,
        dedupKey: `support-refund:${handoff.id}:${input.nextStatus}`,
        eventType: `support_refund_${input.nextStatus}`,
        actorType: "platform_finance",
        actorId: input.actorUserId,
        sanitizedData: {
          supportCaseId: handoff.supportCaseId,
          completedRefundIds,
          completedAmountCents: input.nextStatus === "completed" ? completion.completedAmountCents : null,
        },
        occurredAt: now,
        createdAt: now,
      },
    }),
  ]);
  return { ...handoff, status: input.nextStatus, revision: handoff.revision + 1 };
}
