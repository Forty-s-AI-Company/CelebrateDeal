import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFinanceAdmin: vi.fn(), vendorFindMany: vi.fn(), reconciliationFindMany: vi.fn(), alertFindMany: vi.fn(), importAction: vi.fn(), resolveAction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ vendor: { findMany: mocks.vendorFindMany }, streamUsageReconciliation: { findMany: mocks.reconciliationFindMany }, streamOperationsAlert: { findMany: mocks.alertFindMany } }) }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));
vi.mock("./actions", () => ({ importStreamUsageReconciliationAction: mocks.importAction, resolveStreamUsageReconciliationAction: mocks.resolveAction }));

import AdminStreamReconciliationPage from "./page";

const mismatch = { id: "recon-1", provider: "CLOUDFLARE", monthKey: "2026-08", providerWatchMinutes: 120, providerStorageMinutes: null, internalWatchMinutes: 100, differenceMinutes: 20, status: "MISMATCH", evidenceKind: "ADMIN_ATTESTED_DIGEST", resolution: null, sourceDigest: "a".repeat(64), capturedAt: new Date("2026-08-01T00:00:00.000Z"), createdAt: new Date("2026-08-02T00:00:00.000Z"), vendor: { name: "測試商家" } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-1" } });
  mocks.vendorFindMany.mockResolvedValue([{ id: "vendor-1", name: "測試商家" }]);
  mocks.reconciliationFindMany.mockResolvedValue([mismatch]);
  mocks.alertFindMany.mockResolvedValue([{ id: "alert-1", type: "PROVIDER_DISCREPANCY", severity: "CRITICAL", provider: "CLOUDFLARE", monthKey: "2026-08", message: "Provider usage differs from internal ledger.", createdAt: new Date("2026-08-02T00:00:00.000Z"), vendor: { name: "測試商家" } }]);
});

describe("/admin/billing/stream-reconciliation", () => {
  it("guards access, reads only the UI fields, and renders tenant/vendor labels", async () => {
    const html = renderToStaticMarkup(await AdminStreamReconciliationPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.requireFinanceAdmin).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.vendorFindMany).toHaveBeenCalledWith({ orderBy: { name: "asc" }, select: { id: true, name: true } });
    expect(mocks.reconciliationFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50, select: expect.objectContaining({ sourceDigest: true, vendor: { select: { name: true } } }) }));
    expect(html).toContain("測試商家"); expect(html).toContain("CLOUDFLARE"); expect(html).toContain("Provider 對帳差異"); expect(html).toContain("非 provider 簽章");
    expect(html).not.toContain("raw-provider-secret");
  });

  it("shows safe empty states and does not reflect unknown error details", async () => {
    mocks.reconciliationFindMany.mockResolvedValue([]); mocks.alertFindMany.mockResolvedValue([]);
    const html = renderToStaticMarkup(await AdminStreamReconciliationPage({ searchParams: Promise.resolve({ error: "raw-provider-error" }) }));
    expect(html).toContain("尚無對帳紀錄"); expect(html).toContain("目前沒有開放中的配額或差異警示。"); expect(html).toContain("此次操作未完成"); expect(html).not.toContain("raw-provider-error");
  });

  it("renders mismatch decision controls and pending-safe submit semantics", async () => {
    const html = renderToStaticMarkup(await AdminStreamReconciliationPage({ searchParams: Promise.resolve({ status: "imported" }) }));
    expect(html).toContain("ACCEPT_INTERNAL"); expect(html).toContain("ACCEPT_PROVIDER"); expect(html).toContain("ESCALATED"); expect(html).toContain('minLength="10"'); expect(html).toContain('maxLength="500"'); expect(html).toContain('aria-busy="false"'); expect(html).toContain('role="status"'); expect(html).toContain("不會自動扣款"); expect(html).toContain("可影響未鎖定月結");
  });
});
