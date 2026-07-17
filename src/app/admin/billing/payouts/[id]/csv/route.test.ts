import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  payoutBatchUpdate: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    payoutBatch: {
      findUnique: mocks.findUnique,
      update: mocks.payoutBatchUpdate,
    },
  }),
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { GET } from "./route";

const batch = {
  id: "batch-1",
  batchNumber: "PAYOUT-2026-07-001",
  items: [{
    vendor: { name: "示範商家" },
    settlement: { monthKey: "2026-07" },
    bankCode: "812",
    bankAccountNumber: "12345678901234",
    bankAccountName: "王小明",
    payoutAmountCents: 12345,
    status: "pending",
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-1", role: "finance_admin" } });
  mocks.findUnique.mockResolvedValue(batch);
});

describe("/admin/billing/payouts/[id]/csv route", () => {
  it("authorizes a finance admin, queries the batch, and returns its CSV without changing state", async () => {
    const response = await GET(new Request("https://app.example.test/admin/billing/payouts/batch-1/csv"), {
      params: Promise.resolve({ id: batch.id }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const csv = new TextDecoder().decode(bytes);

    expect(mocks.requireFinanceAdmin).toHaveBeenCalledOnce();
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: batch.id },
      include: { items: { include: { vendor: true, settlement: true }, orderBy: { createdAt: "asc" } } },
    });
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="PAYOUT-2026-07-001.csv"');
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv).toBe(
      '"批次編號","商家","月結月份","銀行代碼","銀行帳號","戶名","出款金額","狀態"\n"PAYOUT-2026-07-001","示範商家","2026-07","812","12345678901234","王小明","123.45","pending"',
    );
    expect(mocks.payoutBatchUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("does not query or mutate a batch when finance-admin authorization is denied", async () => {
    const denied = new Error("Forbidden");
    mocks.requireFinanceAdmin.mockRejectedValue(denied);

    await expect(GET(new Request("https://app.example.test/admin/billing/payouts/batch-1/csv"), {
      params: Promise.resolve({ id: batch.id }),
    })).rejects.toThrow(denied);

    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.payoutBatchUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
