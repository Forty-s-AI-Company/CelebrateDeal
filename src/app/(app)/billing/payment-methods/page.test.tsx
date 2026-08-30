import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorFinance: vi.fn(),
  referenceFindMany: vi.fn(),
  membershipFindMany: vi.fn(),
  getPaymentProvider: vi.fn(),
  getCsrfToken: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireVendorFinance }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    paymentMethodReference: { findMany: mocks.referenceFindMany },
    teamMembership: { findMany: mocks.membershipFindMany },
  }),
}));
vi.mock("@/lib/payment-providers", () => ({ getPaymentProvider: mocks.getPaymentProvider }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="csrf-payment-method" /> }));

import PaymentMethodsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorFinance.mockResolvedValue({ vendor: { id: "vendor-current" } });
  mocks.referenceFindMany.mockResolvedValue([
    {
      id: "reference-1",
      scopeType: "VENDOR",
      membershipId: null,
      providerName: "payuni",
      status: "verified",
      verifiedAt: new Date("2026-08-07T00:00:00.000Z"),
      expiresAt: null,
      lastValidatedAt: new Date("2026-08-07T00:00:00.000Z"),
      createdAt: new Date("2026-08-06T00:00:00.000Z"),
      providerPaymentMethodRef: "opaque-secret-reference-must-not-render",
    },
  ]);
  mocks.membershipFindMany.mockResolvedValue([
    {
      id: "membership-1",
      teamId: "team-1",
      team: { name: "北區團隊" },
      vendorMember: { user: { name: "王小明" } },
    },
  ]);
  mocks.getPaymentProvider.mockReturnValue({
    id: "payuni",
    createPaymentMethodSetupSession: vi.fn(),
    verifyPaymentMethodSetupSignature: vi.fn(),
    normalizePaymentMethodSetupPayload: vi.fn(),
  });
  mocks.getCsrfToken.mockResolvedValue("csrf-payment-method");
});

describe("/billing/payment-methods route", () => {
  it("renders actionable vendor and member setup forms without exposing opaque references", async () => {
    const html = renderToStaticMarkup(await PaymentMethodsPage({}));

    expect(html).toContain("付款方式設定");
    expect(html).toContain("北區團隊 · 王小明");
    expect(html).toContain("已驗證");
    expect(html).toContain('name="scopeType" value="VENDOR"');
    expect(html).toContain('name="scopeType" value="MEMBERSHIP"');
    expect(html).toContain('name="membershipId" value="membership-1"');
    expect(html).toContain('name="referenceId" value="reference-1"');
    expect(html).toContain('name="_csrf" value="csrf-payment-method"');
    expect(html.match(/aria-busy="false"/gu) ?? []).toHaveLength(3);
    expect(html.match(/aria-disabled="false"/gu) ?? []).toHaveLength(3);
    expect(html).not.toContain("opaque-secret-reference-must-not-render");
  });

  it("renders safe action feedback for provider setup failures", async () => {
    const html = renderToStaticMarkup(await PaymentMethodsPage({
      searchParams: Promise.resolve({ error: "provider_setup_unsupported" }),
    }));

    expect(html).toContain("目前 provider 尚未提供安全的付款方式設定流程");
    expect(html).toContain("不會要求 CelebrateDeal 儲存卡號或手動 token");
  });

  it("does not present clickable setup actions when the provider has no setup adapter", async () => {
    mocks.getPaymentProvider.mockReturnValue({ id: "payuni" });

    const html = renderToStaticMarkup(await PaymentMethodsPage({}));

    expect(html).not.toContain("開始商店驗證");
    expect(html).not.toContain("開始成員驗證");
    expect(html).toContain("目前沒有可用的安全設定流程");
    expect(html).toContain("等待 provider 提供安全設定流程");
  });

  it("queries references and active memberships in the current vendor scope", async () => {
    await PaymentMethodsPage({});

    expect(mocks.requireVendorFinance).toHaveBeenCalledExactlyOnceWith("/billing/payment-methods");
    expect(mocks.referenceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-current" },
      select: expect.not.objectContaining({ providerPaymentMethodRef: expect.anything() }),
    }));
    expect(mocks.membershipFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-current", status: "ACTIVE", leftAt: null },
    }));
  });

  it("covers every sanitized setup failure and status message without exposing provider data", async () => {
    const errorMessages = [
      ["invalid_scope", "付款方式設定對象無效"],
      ["provider_not_configured", "目前尚未設定可用的付款 provider"],
      ["provider_form_post_unsupported", "provider 要求表單導轉"],
      ["provider_setup_unavailable", "付款方式設定尚未完成"],
      ["provider_setup_failed", "付款 provider 設定流程失敗"],
      ["invalid_reference", "找不到目前商家可管理的付款方式 reference"],
      ["provider_revoke_failed", "provider 撤銷尚未確認"],
      ["local_revoked_provider_unsupported", "本機已停用這個付款方式"],
    ] as const;

    for (const [error, expected] of errorMessages) {
      const html = renderToStaticMarkup(await PaymentMethodsPage({
        searchParams: Promise.resolve({ error: [error, "ignored"] }),
      }));
      expect(html).toContain(expected);
    }

    const revokedHtml = renderToStaticMarkup(await PaymentMethodsPage({
      searchParams: Promise.resolve({ status: ["revoked", "ignored"] }),
    }));
    expect(revokedHtml).toContain("付款方式已撤銷");

    const alreadyRevokedHtml = renderToStaticMarkup(await PaymentMethodsPage({
      searchParams: Promise.resolve({ status: "already_revoked" }),
    }));
    expect(alreadyRevokedHtml).toContain("先前已撤銷");
  });

  it("renders empty and non-active reference states with stable labels", async () => {
    mocks.referenceFindMany.mockResolvedValue([
      {
        id: "reference-pending",
        scopeType: "VENDOR",
        membershipId: null,
        providerName: "payuni",
        status: "pending",
        verifiedAt: null,
        expiresAt: new Date("2026-09-01T00:00:00.000Z"),
        lastValidatedAt: null,
        createdAt: new Date("2026-08-06T00:00:00.000Z"),
      },
      {
        id: "reference-expired",
        scopeType: "MEMBERSHIP",
        membershipId: "membership-unknown",
        providerName: "payuni",
        status: "expired",
        verifiedAt: new Date("2026-08-01T00:00:00.000Z"),
        expiresAt: new Date("2026-08-02T00:00:00.000Z"),
        lastValidatedAt: new Date("2026-08-01T00:00:00.000Z"),
        createdAt: new Date("2026-07-31T00:00:00.000Z"),
      },
      {
        id: "reference-revoked",
        scopeType: "VENDOR",
        membershipId: null,
        providerName: "payuni",
        status: "revoked",
        verifiedAt: null,
        expiresAt: null,
        lastValidatedAt: null,
        createdAt: new Date("2026-07-30T00:00:00.000Z"),
      },
    ]);
    mocks.membershipFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await PaymentMethodsPage({}));

    expect(html).toContain("待驗證");
    expect(html).toContain("已過期");
    expect(html).toContain("已撤銷");
    expect(html).toContain("成員付款方式");
    expect(html).not.toContain('name="referenceId" value="reference-revoked"');

    mocks.referenceFindMany.mockResolvedValue([]);
    const emptyHtml = renderToStaticMarkup(await PaymentMethodsPage({}));
    expect(emptyHtml).toContain("尚無付款方式 reference");
  });

  it("fails closed when provider discovery throws", async () => {
    mocks.getPaymentProvider.mockImplementationOnce(() => {
      throw new Error("provider discovery failed");
    });

    const html = renderToStaticMarkup(await PaymentMethodsPage({}));

    expect(html).toContain("未設定");
    expect(html).toContain("尚未提供設定流程");
    expect(html).not.toContain("開始商店驗證");
  });
});
