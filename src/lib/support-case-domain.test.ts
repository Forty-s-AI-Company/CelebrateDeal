import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addBuyerSupportReply,
  addSupportCaseCustomerReply,
  addSupportCaseNote,
  createBuyerSupportCase,
  requestSupportRefundHandoff,
  reviewSupportRefundHandoff,
  SupportCaseDomainError,
  transitionSupportCase,
} from "@/lib/support-case-domain";

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    vendorMember: { findFirst: vi.fn().mockResolvedValue({ id: "member-1" }) },
    supportCase: {
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    supportCaseEvent: {
      create: vi.fn().mockResolvedValue({ id: "event-1" }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    buyerSupportOrderGrant: { findFirst: vi.fn() },
    supportRefundHandoff: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    commerceOrderRefund: { findMany: vi.fn() },
    supportRefundHandoffRefund: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    commerceOrderEvent: { create: vi.fn().mockResolvedValue({ id: "order-event-1" }) },
    ...overrides,
  };
}

beforeEach(() => {
  process.env.CSRF_SECRET = "support-domain-test-secret-with-at-least-32-bytes";
});

describe("support case domain", () => {
  it("creates a buyer case only from an active order-bound grant and derives SLA priority", async () => {
    const now = new Date("2026-08-08T12:00:00.000Z");
    const tx = transaction();
    vi.mocked(tx.buyerSupportOrderGrant.findFirst).mockResolvedValue({
      id: "grant-1", vendorId: "vendor-1", orderId: "order-1", rotationCount: 2,
    });
    vi.mocked(tx.supportCase.create).mockImplementation(async ({ data }) => data as never);

    const result = await createBuyerSupportCase(tx as unknown as Prisma.TransactionClient, {
      grantId: "grant-1", intakeKey: "intake-1", category: "refund",
      summary: "退款尚未入帳", now,
    });

    expect(result.supportCase).toMatchObject({
      vendorId: "vendor-1", orderId: "order-1", priority: "p1",
      createdByMemberId: null, createdByBuyerGrantId: "grant-1",
      responseDueAt: new Date("2026-08-08T13:00:00.000Z"),
    });
    expect(tx.supportCaseEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        audience: "buyer", actorBuyerOrderId: "order-1", actorBuyerGrantId: "grant-1",
      }),
    }));
    expect(JSON.stringify(vi.mocked(tx.supportCaseEvent.create).mock.calls)).not.toContain("退款尚未入帳");
  });

  it("rejects a buyer grant that is not bound to the case order", async () => {
    const tx = transaction();
    vi.mocked(tx.supportCase.findFirst).mockResolvedValue({
      id: "case-1", vendorId: "vendor-1", orderId: "order-1", status: "open", revision: 1,
    });
    vi.mocked(tx.buyerSupportOrderGrant.findFirst).mockResolvedValue(null);

    await expect(addBuyerSupportReply(tx as unknown as Prisma.TransactionClient, {
      grantId: "grant-other", supportCaseId: "case-1", expectedRevision: 1,
      dedupKey: "reply-1", message: "跨訂單嘗試",
    })).rejects.toMatchObject({ code: "buyer_access_unavailable" } satisfies Partial<SupportCaseDomainError>);
    expect(tx.supportCase.updateMany).not.toHaveBeenCalled();
  });

  it("does not expose or mutate a same-order case that has never been shared with the buyer", async () => {
    const tx = transaction();
    vi.mocked(tx.supportCase.findFirst).mockResolvedValue({
      id: "internal-case", vendorId: "vendor-1", orderId: "order-1",
      status: "open", revision: 1, createdByBuyerGrantId: null,
    });
    vi.mocked(tx.buyerSupportOrderGrant.findFirst).mockResolvedValue({
      id: "grant-1", vendorId: "vendor-1", orderId: "order-1", rotationCount: 2,
    });
    vi.mocked(tx.supportCaseEvent.findFirst).mockResolvedValue(null);

    await expect(addBuyerSupportReply(tx as unknown as Prisma.TransactionClient, {
      grantId: "grant-1", supportCaseId: "internal-case", expectedRevision: 1,
      dedupKey: "reply-internal", message: "不應寫入內部案件",
    })).rejects.toMatchObject({ code: "case_unavailable" } satisfies Partial<SupportCaseDomainError>);
    expect(tx.supportCase.updateMany).not.toHaveBeenCalled();
    expect(tx.supportCaseEvent.create).not.toHaveBeenCalled();
  });

  it("allows a reply after support explicitly created a buyer-visible event", async () => {
    const tx = transaction();
    vi.mocked(tx.supportCase.findFirst).mockResolvedValue({
      id: "shared-case", vendorId: "vendor-1", orderId: "order-1",
      status: "waiting_customer", revision: 2, createdByBuyerGrantId: null,
    });
    vi.mocked(tx.buyerSupportOrderGrant.findFirst).mockResolvedValue({
      id: "grant-1", vendorId: "vendor-1", orderId: "order-1", rotationCount: 2,
    });
    vi.mocked(tx.supportCaseEvent.findFirst)
      .mockResolvedValueOnce({ id: "shared-event" })
      .mockResolvedValueOnce(null);

    const result = await addBuyerSupportReply(tx as unknown as Prisma.TransactionClient, {
      grantId: "grant-1", supportCaseId: "shared-case", expectedRevision: 2,
      dedupKey: "reply-shared", message: "已收到客服通知",
    });

    expect(result.supportCase).toMatchObject({ status: "in_progress", revision: 3 });
    expect(tx.supportCaseEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        audience: "buyer", actorBuyerOrderId: "order-1", actorBuyerGrantId: "grant-1",
      }),
    }));
  });

  it("does not count an internal note as the first customer response", async () => {
    const tx = transaction();
    vi.mocked(tx.supportCase.findFirst).mockResolvedValue({ id: "case-1", status: "open", revision: 1 });

    await addSupportCaseNote(tx as unknown as Prisma.TransactionClient, {
      vendorId: "vendor-1", supportCaseId: "case-1", expectedRevision: 1,
      dedupKey: "note-1", note: "內部確認中", actorMemberId: "member-1",
    });

    expect(tx.supportCase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ firstRespondedAt: expect.anything() }),
    }));
  });

  it("rejects invalid internal notes before reading or writing case data", async () => {
    const tx = transaction();

    await expect(addSupportCaseNote(tx as unknown as Prisma.TransactionClient, {
      vendorId: "vendor-1", supportCaseId: "case-1", expectedRevision: 1,
      dedupKey: "note-invalid", note: " ".repeat(4_001), actorMemberId: "member-1",
    })).rejects.toMatchObject({ code: "invalid_content" } satisfies Partial<SupportCaseDomainError>);
    expect(tx.supportCase.findFirst).not.toHaveBeenCalled();
    expect(tx.supportCaseEvent.create).not.toHaveBeenCalled();
  });

  it("records the first response only when support sends a buyer-visible message", async () => {
    const now = new Date("2026-08-08T12:15:00.000Z");
    const tx = transaction();
    vi.mocked(tx.supportCase.findFirst).mockResolvedValue({
      id: "case-1", status: "open", revision: 1, firstRespondedAt: null,
    });

    await addSupportCaseCustomerReply(tx as unknown as Prisma.TransactionClient, {
      vendorId: "vendor-1", supportCaseId: "case-1", expectedRevision: 1,
      dedupKey: "reply-1", message: "客服已開始處理", actorMemberId: "member-1", now,
    });

    expect(tx.supportCase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ firstRespondedAt: now, status: "waiting_customer" }),
    }));
    expect(tx.supportCaseEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "customer_reply_added", audience: "buyer" }),
    }));
  });
  it("preserves the original resolution time when a resolved case is closed", async () => {
    const resolvedAt = new Date("2026-08-08T10:00:00.000Z");
    const closedAt = new Date("2026-08-08T12:00:00.000Z");
    const tx = transaction();
    vi.mocked(tx.supportCase.findFirst).mockResolvedValue({
      id: "case-1", status: "resolved", revision: 3, resolvedAt, refundHandoff: null,
    });

    await transitionSupportCase(tx as unknown as Prisma.TransactionClient, {
      vendorId: "vendor-1", supportCaseId: "case-1", expectedRevision: 3,
      nextStatus: "closed", actorMemberId: "member-1", dedupKey: "event-1", now: closedAt,
    });

    expect(tx.supportCase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ resolvedAt, closedAt }),
    }));
  });

  it("blocks resolution while a refund handoff is active", async () => {
    const tx = transaction();
    vi.mocked(tx.supportCase.findFirst).mockResolvedValue({
      id: "case-1", status: "waiting_finance", revision: 2, resolvedAt: null,
      refundHandoff: { status: "reviewing" },
    });

    await expect(transitionSupportCase(tx as unknown as Prisma.TransactionClient, {
      vendorId: "vendor-1", supportCaseId: "case-1", expectedRevision: 2,
      nextStatus: "resolved", actorMemberId: "member-1", dedupKey: "event-2",
    })).rejects.toMatchObject({ code: "invalid_transition" } satisfies Partial<SupportCaseDomainError>);
    expect(tx.supportCase.updateMany).not.toHaveBeenCalled();
  });

  it("creates only a finance handoff for an eligible remaining amount", async () => {
    const tx = transaction();
    vi.mocked(tx.supportCase.findFirst).mockResolvedValue({
      id: "case-1", orderId: "order-1", status: "in_progress", revision: 4,
      refundHandoff: null,
      order: {
        id: "order-1", status: "partially_refunded", paidAmountCents: 10_000,
        refundedAmountCents: 2_000, primaryPaymentTransactionId: "payment-1",
      },
    });
    vi.mocked(tx.supportRefundHandoff.create).mockImplementation(async ({ data }) => data as never);

    const handoff = await requestSupportRefundHandoff(tx as unknown as Prisma.TransactionClient, {
      vendorId: "vendor-1", supportCaseId: "case-1", expectedRevision: 4,
      requestedAmountCents: 8_000, reason: "買家取消服務", actorMemberId: "member-1",
      dedupKey: "refund-request-1", now: new Date("2026-08-08T12:00:00.000Z"),
    });

    expect(handoff).toMatchObject({ status: "requested", requestedAmountCents: 8_000 });
    expect(tx.supportRefundHandoff.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ paymentTransactionId: "payment-1", status: "requested" }),
    }));
    expect(JSON.stringify(vi.mocked(tx.supportRefundHandoff.create).mock.calls)).not.toContain("買家取消服務");
  });

  it("rejects an empty refund reason before reading or writing case data", async () => {
    const tx = transaction();

    await expect(requestSupportRefundHandoff(tx as unknown as Prisma.TransactionClient, {
      vendorId: "vendor-1", supportCaseId: "case-1", expectedRevision: 4,
      requestedAmountCents: 1_000, reason: "   ", actorMemberId: "member-1",
      dedupKey: "refund-invalid",
    })).rejects.toMatchObject({ code: "invalid_content" } satisfies Partial<SupportCaseDomainError>);
    expect(tx.supportCase.findFirst).not.toHaveBeenCalled();
    expect(tx.supportRefundHandoff.create).not.toHaveBeenCalled();
  });

  it("completes a handoff with an exact, auditable set of processed partial refunds", async () => {
    const tx = transaction();
    vi.mocked(tx.supportRefundHandoff.findUnique).mockResolvedValue({
      id: "handoff-1", vendorId: "vendor-1", supportCaseId: "case-1", orderId: "order-1",
      paymentTransactionId: "payment-1", status: "reviewing", revision: 2, requestedAmountCents: 5_000,
      supportCase: { revision: 5, status: "waiting_finance" },
    });
    vi.mocked(tx.commerceOrderRefund.findMany).mockResolvedValue([
      { id: "refund-1", amountCents: 2_000 },
    ]);

    const input = {
      handoffId: "handoff-1", expectedRevision: 2, nextStatus: "completed" as const,
      actorUserId: "finance-1", completedRefundIds: ["refund-1", "refund-2"], dedupKey: "review-1",
    };
    await expect(reviewSupportRefundHandoff(tx as unknown as Prisma.TransactionClient, input))
      .rejects.toMatchObject({ code: "refund_unavailable" } satisfies Partial<SupportCaseDomainError>);
    expect(tx.supportRefundHandoff.updateMany).not.toHaveBeenCalled();
    expect(tx.supportRefundHandoffRefund.createMany).not.toHaveBeenCalled();

    vi.mocked(tx.commerceOrderRefund.findMany).mockResolvedValue([
      { id: "refund-2", amountCents: 3_000 },
      { id: "refund-1", amountCents: 2_000 },
    ]);
    await reviewSupportRefundHandoff(tx as unknown as Prisma.TransactionClient, input);
    expect(tx.commerceOrderRefund.findMany).toHaveBeenLastCalledWith({
      where: {
        id: { in: ["refund-1", "refund-2"] }, vendorId: "vendor-1", orderId: "order-1",
        paymentTransactionId: "payment-1", status: "processed",
      },
      select: { id: true, amountCents: true },
    });
    expect(tx.supportRefundHandoffRefund.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ refundId: "refund-1", amountCentsSnapshot: 2_000 }),
        expect.objectContaining({ refundId: "refund-2", amountCentsSnapshot: 3_000 }),
      ],
    });
    expect(tx.supportRefundHandoff.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ completedRefundId: "refund-1", status: "completed" }),
    }));
    expect(tx.supportCase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "resolved" }),
    }));
  });

  it("rejects a processed refund that is already linked to another support handoff", async () => {
    const tx = transaction();
    vi.mocked(tx.supportRefundHandoff.findUnique).mockResolvedValue({
      id: "handoff-1", vendorId: "vendor-1", supportCaseId: "case-1", orderId: "order-1",
      paymentTransactionId: "payment-1", status: "reviewing", revision: 2, requestedAmountCents: 5_000,
      supportCase: { revision: 5, status: "waiting_finance" },
    });
    vi.mocked(tx.commerceOrderRefund.findMany).mockResolvedValue([{ id: "refund-1", amountCents: 5_000 }]);
    vi.mocked(tx.supportRefundHandoffRefund.findMany).mockResolvedValue([{ refundId: "refund-1" }]);

    await expect(reviewSupportRefundHandoff(tx as unknown as Prisma.TransactionClient, {
      handoffId: "handoff-1", expectedRevision: 2, nextStatus: "completed",
      actorUserId: "finance-1", completedRefundIds: ["refund-1"], dedupKey: "review-1",
    })).rejects.toMatchObject({ code: "refund_unavailable" } satisfies Partial<SupportCaseDomainError>);
    expect(tx.supportRefundHandoffRefund.createMany).not.toHaveBeenCalled();
    expect(tx.supportRefundHandoff.updateMany).not.toHaveBeenCalled();
  });
});
