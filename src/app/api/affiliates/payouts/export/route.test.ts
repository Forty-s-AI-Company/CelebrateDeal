import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  decryptBankAccount: vi.fn(),
  decryptTaxIdentity: vi.fn(),
  findMany: vi.fn(),
  readFormDataBody: vi.fn(),
  requireVendorFinance: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireVendorFinance }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/api-security", () => ({ readFormDataBody: mocks.readFormDataBody }));
vi.mock("@/lib/bank-account", () => ({ decryptBankAccount: mocks.decryptBankAccount }));
vi.mock("@/lib/tax-identity", () => ({ decryptTaxIdentity: mocks.decryptTaxIdentity }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ affiliatePayout: { findMany: mocks.findMany } }) }));

import { POST } from "./route";

const vendor = { id: "vendor-current" };
const payout = {
  id: "payout-current",
  vendorId: vendor.id,
  monthKey: "2026-09",
  status: "pending",
  requestedAt: new Date("2026-09-01T00:00:00.000Z"),
  signedAt: new Date("2026-09-02T00:00:00.000Z"),
  requestedBankAccountEncrypted: "encrypted-bank-fixture",
  requestedTaxIdentityEncrypted: "encrypted-tax-fixture",
  grossAmountCents: 12_345,
  withholdingTaxCents: 1_234,
  nhiSupplementaryTaxCents: 321,
  bankFeeCents: 15,
  netPayoutAmountCents: 10_775,
  taxCategory: "92_other",
  affiliate: { name: "export-name-fixture" },
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
};

function form(type: string) {
  const value = new FormData();
  value.set("_csrf", "csrf-fixture");
  value.set("type", type);
  return value;
}

function request(type = "bank") {
  return new Request(`https://app.example.test/api/affiliates/payouts/export?type=${type}`, { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorFinance.mockResolvedValue({
    vendor,
    user: { id: "user-current" },
    member: { id: "member-current", role: "accountant" },
  });
  mocks.readFormDataBody.mockResolvedValue(form("bank"));
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.findMany.mockResolvedValue([payout]);
  mocks.decryptBankAccount.mockReturnValue({ accountName: "export-account-name", bankCode: "000", accountNumber: "account-fixture" });
  mocks.decryptTaxIdentity.mockReturnValue("tax-id-fixture");
  mocks.writeAuditLog.mockResolvedValue(undefined);
});

describe("POST /api/affiliates/payouts/export", () => {
  it("requires finance MFA/CSRF, scopes signed pending requests to the current vendor, and exports the bank import CSV", async () => {
    const response = await POST(request("bank"));
    const bytes = new Uint8Array(await response.arrayBuffer());
    const csv = new TextDecoder().decode(bytes);

    expect(mocks.requireVendorFinance).toHaveBeenCalledExactlyOnceWith("/affiliates/commissions");
    expect(mocks.assertServerActionSecurity).toHaveBeenCalledExactlyOnceWith(expect.any(FormData));
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        vendorId: vendor.id,
        requestedAt: { not: null },
        signedAt: { not: null },
        status: "pending",
      },
      orderBy: [{ monthKey: "asc" }, { createdAt: "asc" }],
      include: { affiliate: { select: { name: true } } },
    });
    expect(mocks.decryptBankAccount).toHaveBeenCalledWith("encrypted-bank-fixture", vendor.id);
    expect(mocks.decryptTaxIdentity).not.toHaveBeenCalled();
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv).toContain('"戶名","銀行代碼","分行","帳號","實付金額"');
    expect(csv).toContain('"export-account-name","000","","account-fixture","107.75"');
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="affiliate-payouts-bank.csv"');
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith({
      vendorId: vendor.id,
      actorId: "user-current",
      actorLabel: "accountant",
      action: "download_affiliate_payout_bank_csv",
      targetType: "AffiliatePayoutExport",
      after: { exportType: "bank", payoutCount: 1 },
    });
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain("account-fixture");
  });

  it("exports tax columns with formula-neutralized values while keeping the decrypted identity out of audit data", async () => {
    mocks.readFormDataBody.mockResolvedValue(form("tax"));
    mocks.findMany.mockResolvedValue([{ ...payout, taxCategory: "=unsafe-formula" }]);

    const response = await POST(request("tax"));
    const csv = await response.text();

    expect(mocks.decryptTaxIdentity).toHaveBeenCalledWith("encrypted-tax-fixture", vendor.id);
    expect(mocks.decryptBankAccount).not.toHaveBeenCalled();
    expect(csv).toContain('"所得人身分證字號","姓名","所得格式代號","給付總額","扣繳稅額","健保費","所得所屬年月"');
    expect(csv).toContain('"tax-id-fixture","export-name-fixture","\'=unsafe-formula","123.45","12.34","3.21","2026-09"');
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="affiliate-payouts-tax.csv"');
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "download_affiliate_payout_tax_csv",
      after: { exportType: "tax", payoutCount: 1 },
    }));
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain("tax-id-fixture");
  });

  it("rejects a missing or invalid CSRF check before querying payout data", async () => {
    mocks.assertServerActionSecurity.mockRejectedValue(new Error("Invalid CSRF token."));

    await expect(POST(request())).rejects.toThrow("Invalid CSRF token.");

    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("does not inspect a request body or tenant data when finance/MFA authorization is denied", async () => {
    const denied = new Error("redirect:/mfa/verify");
    mocks.requireVendorFinance.mockRejectedValue(denied);

    await expect(POST(request())).rejects.toThrow(denied);

    expect(mocks.readFormDataBody).not.toHaveBeenCalled();
    expect(mocks.assertServerActionSecurity).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("fails closed without a partial CSV or audit entry when a requested encrypted snapshot cannot be decrypted", async () => {
    mocks.decryptBankAccount.mockImplementation(() => { throw new Error("decrypt failed"); });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Payout export data is unavailable" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
