import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorManagerMfa: vi.fn(),
  requireVendorSupportMfa: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  transaction: vi.fn(),
  supportCaseFindUnique: vi.fn(),
  supportCaseFindFirst: vi.fn(),
  createCase: vi.fn(),
  addNote: vi.fn(),
  assignCase: vi.fn(),
  transitionCase: vi.fn(),
  customerReply: vi.fn(),
  requestRefund: vi.fn(),
  reviewRefund: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({
  requireVendorManagerMfa: mocks.requireVendorManagerMfa,
  requireVendorSupportMfa: mocks.requireVendorSupportMfa,
  requireFinanceAdmin: mocks.requireFinanceAdmin,
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({
  $transaction: mocks.transaction,
  supportCase: { findUnique: mocks.supportCaseFindUnique, findFirst: mocks.supportCaseFindFirst },
}) }));
vi.mock("@/lib/support-case-domain", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/support-case-domain")>();
  return {
    ...original,
    createSupportCase: mocks.createCase,
    addSupportCaseNote: mocks.addNote,
    assignSupportCase: mocks.assignCase,
    transitionSupportCase: mocks.transitionCase,
    addSupportCaseCustomerReply: mocks.customerReply,
    requestSupportRefundHandoff: mocks.requestRefund,
    reviewSupportRefundHandoff: mocks.reviewRefund,
  };
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  addSupportCaseNoteAction,
  addSupportCaseCustomerReplyAction,
  assignSupportCaseAction,
  createSupportCaseAction,
  requestSupportRefundHandoffAction,
  reviewSupportRefundHandoffAction,
  transitionSupportCaseAction,
} from "@/app/actions/support-case-actions";

const UUID = "11111111-1111-4111-8111-111111111111";

function form(fields: Record<string, string>) {
  const data = new FormData();
  data.set("_csrf", "synthetic");
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManagerMfa.mockResolvedValue({
    vendor: { id: "vendor-1" }, member: { id: "member-1", role: "owner" },
  });
  mocks.requireVendorSupportMfa.mockResolvedValue({
    vendor: { id: "vendor-1" }, member: { id: "support-1", role: "support" },
  });
  mocks.requireFinanceAdmin.mockResolvedValue({ user: { id: "finance-1" } });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({}));
  mocks.createCase.mockResolvedValue({ id: "case-1", orderId: "order-1" });
  mocks.addNote.mockResolvedValue({ id: "case-1", revision: 5 });
  mocks.assignCase.mockResolvedValue({ id: "case-1", revision: 5 });
  mocks.transitionCase.mockResolvedValue({ id: "case-1", revision: 5 });
  mocks.customerReply.mockResolvedValue({ id: "case-1", revision: 5 });
  mocks.requestRefund.mockResolvedValue({ id: "handoff-1", supportCaseId: "case-1" });
  mocks.reviewRefund.mockResolvedValue({ id: "handoff-1", supportCaseId: "case-1" });
});

describe("support case actions", () => {
  it("derives the tenant and actor from MFA context when creating a case", async () => {
    const data = form({
      orderId: "order-1", intakeKey: UUID, category: "general", priority: "p2",
      summary: "買家無法取得課程", vendorId: "forged-vendor",
    });
    await expect(createSupportCaseAction(data)).rejects.toThrow("redirect:/support-cases/case-1?updated=created");
    expect(mocks.createCase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      vendorId: "vendor-1", actorMemberId: "member-1", orderId: "order-1",
    }));
  });

  it("parses decimal currency exactly and creates no provider-side refund", async () => {
    const data = form({
      supportCaseId: "case-1", revision: "4", dedupKey: UUID,
      requestedAmount: "123.45", reason: "未提供服務",
    });
    await expect(requestSupportRefundHandoffAction(data))
      .rejects.toThrow("redirect:/support-cases/case-1?updated=refund_requested");
    expect(mocks.requestRefund).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      vendorId: "vendor-1", requestedAmountCents: 12_345,
    }));
  });

  it("requires platform finance authorization for handoff review", async () => {
    const data = form({
      handoffId: "handoff-1", revision: "2", dedupKey: UUID,
      nextStatus: "completed",
    });
    data.append("completedRefundIds", "refund-1");
    data.append("completedRefundIds", "refund-2");
    await expect(reviewSupportRefundHandoffAction(data))
      .rejects.toThrow("redirect:/admin/support-cases/handoff-1?updated=completed");
    expect(mocks.requireFinanceAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.reviewRefund).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorUserId: "finance-1", completedRefundIds: ["refund-1", "refund-2"], nextStatus: "completed",
    }));
  });

  it("rejects duplicate refund selections before finance authorization", async () => {
    const data = form({
      handoffId: "handoff-1", revision: "2", dedupKey: UUID,
      nextStatus: "completed",
    });
    data.append("completedRefundIds", "refund-1");
    data.append("completedRefundIds", "refund-1");

    await expect(reviewSupportRefundHandoffAction(data))
      .rejects.toThrow("redirect:/admin/support-cases?error=invalid_handoff");
    expect(mocks.requireFinanceAdmin).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("lets the least-privilege support role send a buyer-visible reply", async () => {
    const data = form({
      supportCaseId: "case-1", revision: "4", dedupKey: UUID,
      message: "已收到，我們正在確認。",
    });
    await expect(addSupportCaseCustomerReplyAction(data))
      .rejects.toThrow("redirect:/support-cases/case-1?updated=customer_reply");
    expect(mocks.requireVendorSupportMfa).toHaveBeenCalledWith("/support-cases/case-1");
    expect(mocks.customerReply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      vendorId: "vendor-1", actorMemberId: "support-1", message: "已收到，我們正在確認。",
    }));
    expect(mocks.requireVendorManagerMfa).not.toHaveBeenCalled();
  });

  it("lets the support role add an internal note without manager privileges", async () => {
    const data = form({
      supportCaseId: "case-1", revision: "4", dedupKey: UUID,
      note: "已核對訂單，目前等待商家確認。",
    });
    await expect(addSupportCaseNoteAction(data))
      .rejects.toThrow("redirect:/support-cases/case-1?updated=note");
    expect(mocks.requireVendorSupportMfa).toHaveBeenCalledWith("/support-cases/case-1");
    expect(mocks.addNote).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      vendorId: "vendor-1", actorMemberId: "support-1",
    }));
    expect(mocks.requireVendorManagerMfa).not.toHaveBeenCalled();
  });

  it("rejects an empty internal note before authorization or a transaction", async () => {
    const data = form({
      supportCaseId: "case-1", revision: "4", dedupKey: UUID, note: "   ",
    });
    await expect(addSupportCaseNoteAction(data))
      .rejects.toThrow("redirect:/support-cases?error=invalid_case");
    expect(mocks.requireVendorSupportMfa).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("requires manager authorization before assigning a case owner", async () => {
    const data = form({
      supportCaseId: "case-1", assignedMemberId: "support-2", revision: "4", dedupKey: UUID,
    });
    await expect(assignSupportCaseAction(data))
      .rejects.toThrow("redirect:/support-cases/case-1?updated=assignment");
    expect(mocks.requireVendorManagerMfa).toHaveBeenCalledWith("/support-cases/case-1");
    expect(mocks.requireVendorSupportMfa).not.toHaveBeenCalled();
    expect(mocks.assignCase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      vendorId: "vendor-1", actorMemberId: "member-1", assignedMemberId: "support-2",
    }));
  });

  it("requires manager authorization before changing case status", async () => {
    const data = form({
      supportCaseId: "case-1", nextStatus: "in_progress", revision: "4", dedupKey: UUID,
    });
    await expect(transitionSupportCaseAction(data))
      .rejects.toThrow("redirect:/support-cases/case-1?updated=status");
    expect(mocks.requireVendorManagerMfa).toHaveBeenCalledWith("/support-cases/case-1");
    expect(mocks.requireVendorSupportMfa).not.toHaveBeenCalled();
    expect(mocks.transitionCase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      vendorId: "vendor-1", actorMemberId: "member-1", nextStatus: "in_progress",
    }));
  });

  it("rejects invalid money before starting a transaction", async () => {
    const data = form({
      supportCaseId: "case-1", revision: "4", dedupKey: UUID,
      requestedAmount: "0.001", reason: "invalid",
    });
    await expect(requestSupportRefundHandoffAction(data))
      .rejects.toThrow("redirect:/support-cases?error=invalid_refund");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an oversized refund reason before manager authorization", async () => {
    const data = form({
      supportCaseId: "case-1", revision: "4", dedupKey: UUID,
      requestedAmount: "100", reason: "x".repeat(4_001),
    });
    await expect(requestSupportRefundHandoffAction(data))
      .rejects.toThrow("redirect:/support-cases?error=invalid_refund");
    expect(mocks.requireVendorManagerMfa).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
