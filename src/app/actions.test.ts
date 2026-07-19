import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  authenticateUser: vi.fn(),
  calculateSettlement: vi.fn(),
  cookies: vi.fn(),
  createUserSession: vi.fn(),
  findUnique: vi.fn(),
  headers: vi.fn(),
  invoiceUpsert: vi.fn(),
  interactionEventCreate: vi.fn(),
  interactionEventDeleteMany: vi.fn(),
  interactionRoleCreateMany: vi.fn(),
  interactionRoleFindMany: vi.fn(),
  interactionScriptCreate: vi.fn(),
  interactionScriptUpdate: vi.fn(),
  markCurrentSessionMfaVerified: vi.fn(),
  paymentTransactionUpdate: vi.fn(),
  redirect: vi.fn(),
  refundRecordAggregate: vi.fn(),
  refundRecordCreate: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  requireAuth: vi.fn(),
  requireVendor: vi.fn(),
  requireVendorOwner: vi.fn(),
  revalidatePath: vi.fn(),
  checkRateLimit: vi.fn(),
  sendPasswordResetLink: vi.fn(),
  settlementFindUnique: vi.fn(),
  settlementUpsert: vi.fn(),
  partnerFunnelPageFindFirst: vi.fn(),
  partnerFunnelPageUpdateMany: vi.fn(),
  teamMembershipFindFirst: vi.fn(),
  teamMembershipFindMany: vi.fn(),
  teamMembershipRelationshipFindMany: vi.fn(),
  transaction: vi.fn(),
  userCreate: vi.fn(),
  userFindUnique: vi.fn(),
  userMfaFactorUpdate: vi.fn(),
  userRecoveryCodeFindMany: vi.fn(),
  userRecoveryCodeUpdate: vi.fn(),
  userUpdate: vi.fn(),
  verifyRecoveryCode: vi.fn(),
  verifyTotpCode: vi.fn(),
  decryptMfaSecret: vi.fn(),
  vendorFindUnique: vi.fn(),
  vendorMemberFindFirst: vi.fn(),
  vendorMemberFindMany: vi.fn(),
  vendorMemberFindUnique: vi.fn(),
  vendorMemberUpsert: vi.fn(),
  userSessionFindMany: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies, headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/audit", () => ({
  auditSnapshot: (value: unknown) => value,
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE: "celebrate_session",
  LEGACY_VENDOR_COOKIE: "celebrate_vendor_id",
  authenticateUser: mocks.authenticateUser,
  createUserSession: mocks.createUserSession,
  markCurrentSessionMfaVerified: mocks.markCurrentSessionMfaVerified,
  requireAuth: mocks.requireAuth,
  requireFinanceAdmin: mocks.requireFinanceAdmin,
  requireVendor: mocks.requireVendor,
  requireVendorOwner: mocks.requireVendorOwner,
  sessionCookieOptions: vi.fn(),
}));
vi.mock("@/lib/billing", () => ({
  calculateSettlement: mocks.calculateSettlement,
  invoiceNumber: (vendorSlug: string, monthKey: string) => `${vendorSlug}-${monthKey}`,
}));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/password-reset", () => ({ sendPasswordResetLink: mocks.sendPasswordResetLink }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/mfa", () => ({
  decryptMfaSecret: mocks.decryptMfaSecret,
  generateTotpUri: vi.fn(),
  MFA_RECOVERY_COOKIE: "mfa_recovery_codes",
  MFA_SETUP_COOKIE: "mfa_setup",
  parsePendingMfaSetup: vi.fn(),
  parseRecoveryCodes: vi.fn(),
  verifyRecoveryCode: mocks.verifyRecoveryCode,
  verifyTotpCode: mocks.verifyTotpCode,
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    paymentTransaction: {
      findUnique: mocks.findUnique,
      update: mocks.paymentTransactionUpdate,
    },
    refundRecord: { aggregate: mocks.refundRecordAggregate },
    settlement: { findUnique: mocks.settlementFindUnique },
    interactionEvent: { create: mocks.interactionEventCreate, deleteMany: mocks.interactionEventDeleteMany },
    interactionRole: { createMany: mocks.interactionRoleCreateMany, findMany: mocks.interactionRoleFindMany },
    interactionScript: { create: mocks.interactionScriptCreate, update: mocks.interactionScriptUpdate },
    $transaction: mocks.transaction,
    user: { create: mocks.userCreate, findUnique: mocks.userFindUnique, update: mocks.userUpdate },
    userMfaFactor: { update: mocks.userMfaFactorUpdate },
    userRecoveryCode: {
      findMany: mocks.userRecoveryCodeFindMany,
      update: mocks.userRecoveryCodeUpdate,
    },
    vendor: { findUnique: mocks.vendorFindUnique },
    vendorMember: {
      findFirst: mocks.vendorMemberFindFirst,
      findMany: mocks.vendorMemberFindMany,
      findUnique: mocks.vendorMemberFindUnique,
      upsert: mocks.vendorMemberUpsert,
    },
    teamMembership: { findFirst: mocks.teamMembershipFindFirst, findMany: mocks.teamMembershipFindMany },
    teamMembershipRelationship: { findMany: mocks.teamMembershipRelationshipFindMany },
    partnerFunnelPage: { findFirst: mocks.partnerFunnelPageFindFirst, updateMany: mocks.partnerFunnelPageUpdateMany },
    userSession: { findMany: mocks.userSessionFindMany },
  }),
}));

import {
  createVendorMemberAction,
  generateSettlementAction,
  importSystemRolesAction,
  loginAction,
  refundPaymentTransactionAction,
  resendVendorMemberInvitationAction,
  requestPasswordResetAction,
  upsertInteractionScriptAction,
  verifyMfaAction,
} from "./actions";
import { savePartnerPageAction } from "./actions/team-funnel-partner-actions";
import SecuritySettingsPage from "./(app)/settings/security/page";

const transaction = {
  id: "payment-1",
  vendorId: "vendor-1",
  grossAmountCents: 10_000,
  refundedAmountCents: 6_000,
  gatewayFeeCents: 1_000,
  platformFeeCents: 400,
};

function refundFormData(
  refundAmount: string,
  gatewayFeeRefund = "0",
  platformFeeRefund = "0",
  monthKey = "2026-07",
) {
  const formData = new FormData();
  formData.set("id", transaction.id);
  formData.set("refundAmount", refundAmount);
  formData.set("gatewayFeeRefund", gatewayFeeRefund);
  formData.set("platformFeeRefund", platformFeeRefund);
  formData.set("monthKey", monthKey);
  return formData;
}

function settlementFormData(monthKey: string) {
  const formData = new FormData();
  formData.set("vendorId", "vendor-1");
  formData.set("monthKey", monthKey);
  return formData;
}

function vendorMemberFormData({
  name = "王小明",
  email = "member@example.com",
  role = "accountant",
}: {
  name?: string;
  email?: string;
  role?: string;
} = {}) {
  const formData = new FormData();
  formData.set("name", name);
  formData.set("email", email);
  formData.set("role", role);
  return formData;
}

function resendVendorMemberInvitationFormData(id = "member-2") {
  const formData = new FormData();
  formData.set("id", id);
  return formData;
}

function passwordResetFormData(email = "member@example.com") {
  const formData = new FormData();
  formData.set("email", email);
  return formData;
}

function loginFormData(email = " Member@Example.com ", password = "test-fixture-incorrect-password") {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("password", password);
  return formData;
}

function mfaVerifyFormData(code = "123456", next = "/admin/billing/dashboard") {
  const formData = new FormData();
  formData.set("code", code);
  formData.set("next", next);
  return formData;
}

function interactionScriptFormData(triggerSec: string) {
  const formData = new FormData();
  formData.set("name", "測試留言組");
  formData.set("status", "draft");
  formData.set("eventType", "chat_message");
  formData.set("triggerSec", triggerSec);
  formData.set("eventTitle", "測試留言");
  formData.set("message", "測試留言內容");
  return formData;
}

function formActions(node: unknown): unknown[] {
  if (Array.isArray(node)) return node.flatMap(formActions);
  if (!node || typeof node !== "object" || !("props" in node)) return [];

  const element = node as { type?: unknown; props?: { action?: unknown; children?: unknown } };
  return [
    ...(element.type === "form" ? [element.props?.action] : []),
    ...formActions(element.props?.children),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.authenticateUser.mockResolvedValue(null);
  mocks.cookies.mockResolvedValue({ delete: vi.fn(), set: vi.fn() });
  mocks.createUserSession.mockResolvedValue({ token: "test-fixture-session-token", expiresAt: new Date("2026-07-18T00:00:00.000Z") });
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-1", role: "finance_admin" } });
  mocks.requireAuth.mockResolvedValue({
    user: {
      id: "admin-1",
      platformRole: "platform_admin",
      mfaFactor: { secretEncrypted: "encrypted-totp-secret" },
    },
    vendor: { id: "vendor-1" },
    member: { role: "platform_admin" },
  });
  mocks.requireVendorOwner.mockResolvedValue({
    user: { id: "owner-1" },
    member: { role: "owner" },
    vendor: { id: "vendor-1" },
  });
  mocks.headers.mockResolvedValue({
    get: (name: string) => ({
      "user-agent": "CelebrateDeal test",
      "x-forwarded-for": "203.0.113.10, 198.51.100.1",
    })[name] ?? null,
  });
  mocks.sendPasswordResetLink.mockResolvedValue({ token: "one-time-reset-token", resetUrl: "https://app.test/password-reset/confirm?token=one-time-reset-token" });
  mocks.decryptMfaSecret.mockReturnValue("totp-secret");
  mocks.verifyTotpCode.mockReturnValue(true);
  mocks.verifyRecoveryCode.mockReturnValue(false);
  mocks.userRecoveryCodeFindMany.mockResolvedValue([]);
  mocks.userMfaFactorUpdate.mockResolvedValue({ id: "factor-1" });
  mocks.userRecoveryCodeUpdate.mockResolvedValue({ id: "recovery-1" });
  mocks.markCurrentSessionMfaVerified.mockResolvedValue(undefined);
  mocks.findUnique.mockResolvedValue(transaction);
  mocks.refundRecordAggregate.mockResolvedValue({
    _sum: { gatewayFeeRefundCents: 0, platformFeeRefundCents: 0 },
  });
  mocks.vendorFindUnique.mockResolvedValue({ id: "vendor-1", slug: "vendor" });
  mocks.vendorMemberFindFirst.mockResolvedValue(null);
  mocks.vendorMemberFindMany.mockResolvedValue([]);
  mocks.settlementFindUnique.mockResolvedValue(null);
  mocks.userSessionFindMany.mockResolvedValue([]);
  mocks.calculateSettlement.mockResolvedValue({
    monthlyFeeCents: 1_000,
    overflowFeeCents: 200,
    paymentServiceFeeCents: 300,
    transactionServiceFeeCents: 400,
    affiliateManagementFeeCents: 500,
    paymentGatewayFeeCents: 600,
    grossRevenueCents: 10_000,
    payoutableAmountCents: 8_000,
  });
  mocks.paymentTransactionUpdate.mockResolvedValue({ ...transaction, refundedAmountCents: 10_000, status: "refunded" });
  mocks.interactionRoleFindMany.mockResolvedValue([]);
  mocks.interactionRoleCreateMany.mockResolvedValue({ count: 0 });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    paymentTransaction: {
      findUnique: mocks.findUnique,
      update: mocks.paymentTransactionUpdate,
    },
    refundRecord: {
      aggregate: mocks.refundRecordAggregate,
      create: mocks.refundRecordCreate,
    },
  }));
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});

describe("loginAction", () => {
  it("blocks a source-wide limit before credential verification, session creation, or login-failure auditing", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    const formData = loginFormData();

    await expect(loginAction(formData)).rejects.toThrow("redirect:/login?error=rate_limited");

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      "login-source",
      20,
      15 * 60 * 1000,
    );
    const [rateLimitRequest] = mocks.checkRateLimit.mock.calls[0] as [Request];
    expect(rateLimitRequest.headers.get("x-forwarded-for")).toBe("203.0.113.10, 198.51.100.1");
    expect(mocks.authenticateUser).not.toHaveBeenCalled();
    expect(mocks.createUserSession).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("forwards the trusted Cloudflare source to the limiter ahead of x-forwarded-for", async () => {
    mocks.headers.mockResolvedValueOnce({
      get: (name: string) => ({
        "cf-connecting-ip": "198.51.100.24",
        "x-forwarded-for": "203.0.113.10, 198.51.100.1",
        "user-agent": "CelebrateDeal test",
      })[name] ?? null,
    });
    mocks.checkRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));

    await expect(loginAction(loginFormData())).rejects.toThrow("redirect:/login?error=rate_limited");

    const [rateLimitRequest] = mocks.checkRateLimit.mock.calls[0] as [Request];
    expect(rateLimitRequest.headers.get("cf-connecting-ip")).toBe("198.51.100.24");
    expect(rateLimitRequest.headers.get("x-forwarded-for")).toBe("203.0.113.10, 198.51.100.1");
    expect(mocks.authenticateUser).not.toHaveBeenCalled();
  });

  it("blocks a source and normalized-email limit before credential verification, session creation, or login-failure auditing", async () => {
    mocks.checkRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Response(null, { status: 429 }));
    const formData = loginFormData();

    await expect(loginAction(formData)).rejects.toThrow("redirect:/login?error=rate_limited");

    expect(mocks.checkRateLimit).toHaveBeenNthCalledWith(
      1,
      expect.any(Request),
      "login-source",
      20,
      15 * 60 * 1000,
    );
    expect(mocks.checkRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.any(Request),
      "login-source-email:member@example.com",
      5,
      15 * 60 * 1000,
    );
    expect(mocks.authenticateUser).not.toHaveBeenCalled();
    expect(mocks.createUserSession).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("fails closed when the rate-limit service is unavailable without authenticating, creating a session, or auditing a failed login", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(loginAction(loginFormData())).rejects.toThrow(
      "redirect:/login?error=temporarily_unavailable",
    );

    expect(mocks.authenticateUser).not.toHaveBeenCalled();
    expect(mocks.createUserSession).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("fails closed when the source-and-email limiter is unavailable without authenticating, creating a session, or auditing", async () => {
    mocks.checkRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(loginAction(loginFormData())).rejects.toThrow(
      "redirect:/login?error=temporarily_unavailable",
    );

    expect(mocks.authenticateUser).not.toHaveBeenCalled();
    expect(mocks.createUserSession).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("savePartnerPageAction", () => {
  it("ignores forged partner contact fields and never updates the user account", async () => {
    const membership = {
      id: "membership-1",
      vendorId: "vendor-1",
      teamId: "team-1",
      vendorMemberId: "vendor-member-1",
      status: "ACTIVE",
      leftAt: null,
      vendorMember: { userId: "user-1", status: "active", deactivatedAt: null },
    };
    mocks.requireAuth.mockResolvedValue({
      user: { id: "user-1" },
      member: { id: "vendor-member-1", status: "active", deactivatedAt: null },
    });
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.teamMembershipFindFirst.mockResolvedValue(membership);
    mocks.teamMembershipFindMany.mockResolvedValue([membership]);
    mocks.teamMembershipRelationshipFindMany.mockResolvedValue([]);
    mocks.partnerFunnelPageFindFirst.mockResolvedValue({
      id: "page-1",
      vendorId: "vendor-1",
      teamId: "team-1",
      promoterMembershipId: "membership-1",
      contentOwnerMembershipId: "membership-1",
      slug: "partner-page",
      templateVersion: { fieldLocks: [], productSlots: [] },
    });
    mocks.partnerFunnelPageUpdateMany.mockResolvedValue({ count: 1 });
    const formData = new FormData();
    formData.set("_csrf", "test-fixture-csrf-token");
    formData.set("teamId", "team-1");
    formData.set("pageId", "page-1");
    formData.set("headline", "更新後的主標題");
    formData.set("ctaLabel", "立即報名");
    formData.set("partnerName", "偽造名稱");
    formData.set("partnerEmail", "forged@example.com");

    await expect(savePartnerPageAction({ status: "idle", message: "" }, formData)).resolves.toEqual({ status: "success", message: "夥伴頁已儲存。" });

    expect(mocks.partnerFunnelPageUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { headline: "更新後的主標題", subheadline: null, body: null, ctaLabel: "立即報名", ctaUrl: null },
    }));
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });
});

describe("requestPasswordResetAction", () => {
  it("allows a request after CSRF validation and preserves the non-production reset preview", async () => {
    const formData = passwordResetFormData();

    await expect(requestPasswordResetAction(formData)).rejects.toThrow(
      "redirect:/password-reset/request?updated=sent&preview=https%3A%2F%2Fapp.test%2Fpassword-reset%2Fconfirm%3Ftoken%3Done-time-reset-token",
    );

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(formData);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      "password-reset-request",
      5,
      60_000,
    );
    const [rateLimitRequest] = mocks.checkRateLimit.mock.calls[0] as [Request];
    expect(rateLimitRequest.headers.get("x-forwarded-for")).toBe("203.0.113.10, 198.51.100.1");
    expect(mocks.sendPasswordResetLink).toHaveBeenCalledWith({
      email: "member@example.com",
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:31023",
      ipAddress: "203.0.113.10",
      userAgent: "CelebrateDeal test",
    });
  });

  it("does not create a token or send email when the IP is rate limited", async () => {
    mocks.checkRateLimit.mockResolvedValue(new Response(null, { status: 429 }));

    await expect(requestPasswordResetAction(passwordResetFormData())).rejects.toThrow(
      "redirect:/password-reset/request?error=rate_limited",
    );

    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it("fails closed without sending email when the rate-limit service is unavailable", async () => {
    mocks.checkRateLimit.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(requestPasswordResetAction(passwordResetFormData())).rejects.toThrow(
      "redirect:/password-reset/request?error=temporarily_unavailable",
    );

    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
  });
});

describe("verifyMfaAction", () => {
  it("limits a verified user's MFA attempts by both user ID and forwarded source IP before validating the code", async () => {
    const formData = mfaVerifyFormData();

    await expect(verifyMfaAction(formData)).rejects.toThrow("redirect:/admin/billing/dashboard");

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(formData);
    expect(mocks.requireAuth).toHaveBeenCalledOnce();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      "mfa-verification:admin-1",
      5,
      60_000,
    );
    const [rateLimitRequest] = mocks.checkRateLimit.mock.calls[0] as [Request];
    expect(rateLimitRequest.headers.get("x-forwarded-for")).toBe("203.0.113.10, 198.51.100.1");
    expect(mocks.verifyTotpCode).toHaveBeenCalledWith("totp-secret", "123456");
    expect(mocks.userMfaFactorUpdate).toHaveBeenCalledWith({
      where: { userId: "admin-1" },
      data: { lastUsedAt: expect.any(Date) },
    });
    expect(mocks.markCurrentSessionMfaVerified).toHaveBeenCalledOnce();
  });

  it("does not validate or update MFA state when the attempt limit is exceeded", async () => {
    mocks.checkRateLimit.mockResolvedValue(new Response(null, { status: 429 }));

    await expect(verifyMfaAction(mfaVerifyFormData())).rejects.toThrow(
      "redirect:/mfa/verify?error=rate_limited&next=%2Fadmin%2Fbilling%2Fdashboard",
    );

    expect(mocks.decryptMfaSecret).not.toHaveBeenCalled();
    expect(mocks.userRecoveryCodeFindMany).not.toHaveBeenCalled();
    expect(mocks.verifyTotpCode).not.toHaveBeenCalled();
    expect(mocks.verifyRecoveryCode).not.toHaveBeenCalled();
    expect(mocks.userMfaFactorUpdate).not.toHaveBeenCalled();
    expect(mocks.userRecoveryCodeUpdate).not.toHaveBeenCalled();
    expect(mocks.markCurrentSessionMfaVerified).not.toHaveBeenCalled();
  });

  it("fails closed without validating or updating MFA state when rate limiting is unavailable", async () => {
    mocks.checkRateLimit.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(verifyMfaAction(mfaVerifyFormData())).rejects.toThrow(
      "redirect:/mfa/verify?error=temporarily_unavailable&next=%2Fadmin%2Fbilling%2Fdashboard",
    );

    expect(mocks.decryptMfaSecret).not.toHaveBeenCalled();
    expect(mocks.userRecoveryCodeFindMany).not.toHaveBeenCalled();
    expect(mocks.verifyTotpCode).not.toHaveBeenCalled();
    expect(mocks.verifyRecoveryCode).not.toHaveBeenCalled();
    expect(mocks.userMfaFactorUpdate).not.toHaveBeenCalled();
    expect(mocks.userRecoveryCodeUpdate).not.toHaveBeenCalled();
    expect(mocks.markCurrentSessionMfaVerified).not.toHaveBeenCalled();
  });
});

describe("createVendorMemberAction", () => {
  it("creates a member and sends a one-time password setup invitation without auditing the token or password", async () => {
    const newUser = { id: "user-2", email: "member@example.com", name: "王小明", status: "active", platformRole: "none" };
    const savedMember = { id: "member-2", userId: newUser.id, role: "accountant", status: "active", user: newUser };
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      user: { create: mocks.userCreate, update: mocks.userUpdate },
      vendorMember: { upsert: mocks.vendorMemberUpsert },
    }));
    mocks.userCreate.mockResolvedValue(newUser);
    mocks.userUpdate.mockResolvedValue(newUser);
    mocks.vendorMemberUpsert.mockResolvedValue(savedMember);

    const formData = vendorMemberFormData();
    const suppliedInitialPassword = "initial-password-must-not-be-sent";
    formData.set("password", suppliedInitialPassword);
    await expect(createVendorMemberAction(formData)).rejects.toThrow("redirect:/settings/security?updated=member");

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(formData);
    expect(mocks.requireVendorOwner).toHaveBeenCalledOnce();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      "vendor-member-invitation",
      5,
      60_000,
    );
    const [rateLimitRequest] = mocks.checkRateLimit.mock.calls[0] as [Request];
    expect(rateLimitRequest.headers.get("x-forwarded-for")).toBe("203.0.113.10, 198.51.100.1");
    expect(mocks.userCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: newUser.email,
        name: newUser.name,
        passwordHash: expect.any(String),
      }),
    });
    expect(mocks.vendorMemberUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        vendorId: "vendor-1",
        userId: newUser.id,
        role: "accountant",
        status: "active",
      }),
    }));
    // 與 Server Action 使用相同的環境網址，避免 CI 與本機設定不同時產生假失敗。
    const expectedAppUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:31023";
    expect(mocks.sendPasswordResetLink).toHaveBeenCalledWith({
      email: newUser.email,
      appUrl: expectedAppUrl,
      ipAddress: "203.0.113.10",
      userAgent: "CelebrateDeal test",
    });

    const generatedPasswordHash = mocks.userCreate.mock.calls[0]?.[0].data.passwordHash;
    const auditEntries = JSON.stringify(mocks.writeAuditLog.mock.calls);
    expect(auditEntries).not.toContain("one-time-reset-token");
    expect(auditEntries).not.toContain(generatedPasswordHash);
    expect(auditEntries).not.toContain("passwordHash");
    expect(auditEntries).not.toContain(suppliedInitialPassword);
    expect(JSON.stringify(mocks.sendPasswordResetLink.mock.calls)).not.toContain(suppliedInitialPassword);
  });

  it("does not change members or create password reset tokens when the invitation rate limit is exceeded", async () => {
    mocks.checkRateLimit.mockResolvedValue(new Response(null, { status: 429 }));

    await expect(createVendorMemberAction(vendorMemberFormData())).rejects.toThrow(
      "redirect:/settings/security?error=member_invitation_rate_limited",
    );

    expect(mocks.userFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.vendorMemberUpsert).not.toHaveBeenCalled();
    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it("fails closed without changing members or creating password reset tokens when rate limiting is unavailable", async () => {
    mocks.checkRateLimit.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(createVendorMemberAction(vendorMemberFormData())).rejects.toThrow(
      "redirect:/settings/security?error=member_invitation_unavailable",
    );

    expect(mocks.userFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.vendorMemberUpsert).not.toHaveBeenCalled();
    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it("re-enables an inactive membership and sends a new invitation", async () => {
    const existingUser = { id: "user-2", email: "member@example.com", name: "原本姓名", status: "inactive", platformRole: "none" };
    const inactiveMember = {
      id: "member-2",
      userId: existingUser.id,
      role: "accountant",
      status: "inactive",
      user: { ...existingUser, passwordHash: "existing-password-hash" },
    };
    const savedMember = { ...inactiveMember, role: "admin", status: "active", deactivatedAt: null };
    mocks.userFindUnique.mockResolvedValue(existingUser);
    mocks.vendorMemberFindUnique.mockResolvedValue(inactiveMember);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      user: { create: mocks.userCreate, update: mocks.userUpdate },
      vendorMember: { upsert: mocks.vendorMemberUpsert },
    }));
    mocks.userUpdate.mockResolvedValue(existingUser);
    mocks.vendorMemberUpsert.mockResolvedValue(savedMember);

    await expect(createVendorMemberAction(vendorMemberFormData({ role: "admin" }))).rejects.toThrow("redirect:/settings/security?updated=member");

    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.vendorMemberUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ role: "admin", status: "active", deactivatedAt: null }),
    }));
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: existingUser.id },
      data: { name: existingUser.name, status: "active" },
    });
    expect(mocks.sendPasswordResetLink).toHaveBeenCalledWith(expect.objectContaining({ email: existingUser.email }));
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "reactivate_vendor_member" }));
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain("existing-password-hash");
  });

  it("keeps the membership update but reports an invitation delivery failure without auditing secrets", async () => {
    const newUser = { id: "user-2", email: "member@example.com", name: "王小明", status: "active", platformRole: "none" };
    const savedMember = { id: "member-2", userId: newUser.id, role: "accountant", status: "active", user: newUser };
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      user: { create: mocks.userCreate, update: mocks.userUpdate },
      vendorMember: { upsert: mocks.vendorMemberUpsert },
    }));
    mocks.userCreate.mockResolvedValue(newUser);
    mocks.userUpdate.mockResolvedValue(newUser);
    mocks.vendorMemberUpsert.mockResolvedValue(savedMember);
    mocks.sendPasswordResetLink.mockRejectedValueOnce(new Error("email delivery failed"));

    await expect(createVendorMemberAction(vendorMemberFormData())).rejects.toThrow(
      "redirect:/settings/security?error=member_invitation",
    );

    expect(mocks.writeAuditLog).toHaveBeenLastCalledWith(expect.objectContaining({
      action: "vendor_member_invitation_email_failed",
      after: { email: newUser.email, role: "accountant", status: "active" },
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/security");
    const auditEntries = JSON.stringify(mocks.writeAuditLog.mock.calls);
    expect(auditEntries).not.toContain("one-time-reset-token");
    expect(auditEntries).not.toContain("passwordHash");
  });
});

describe("resendVendorMemberInvitationAction", () => {
  const activeMember = {
    id: "member-2",
    vendorId: "vendor-1",
    userId: "user-2",
    role: "accountant",
    status: "active",
    user: { id: "user-2", email: "member@example.com", platformRole: "none" },
  };

  it("requires an owner after validating CSRF before looking up or emailing a member", async () => {
    mocks.requireVendorOwner.mockRejectedValueOnce(new Error("owner_required"));
    const formData = resendVendorMemberInvitationFormData();

    await expect(resendVendorMemberInvitationAction(formData)).rejects.toThrow("owner_required");

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(formData);
    expect(mocks.vendorMemberFindFirst).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it.each([
    ["a member belonging to another vendor", null],
    ["an inactive member", { ...activeMember, status: "inactive" }],
  ])("rejects %s without sending email", async (_description, member) => {
    mocks.vendorMemberFindFirst.mockResolvedValueOnce(member);

    await expect(resendVendorMemberInvitationAction(resendVendorMemberInvitationFormData())).rejects.toThrow(
      "redirect:/settings/security?error=member_invitation_resend_invalid",
    );

    expect(mocks.vendorMemberFindFirst).toHaveBeenCalledWith({
      where: { id: "member-2", vendorId: "vendor-1", status: "active" },
      include: { user: true },
    });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it("resends a one-time password setup email without changing the member or sessions", async () => {
    mocks.vendorMemberFindFirst.mockResolvedValueOnce(activeMember);

    await expect(resendVendorMemberInvitationAction(resendVendorMemberInvitationFormData())).rejects.toThrow(
      "redirect:/settings/security?updated=member_invitation_resent",
    );

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      "vendor-member-invitation",
      5,
      60_000,
    );
    expect(mocks.sendPasswordResetLink).toHaveBeenCalledWith({
      email: activeMember.user.email,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:31023",
      ipAddress: "203.0.113.10",
      userAgent: "CelebrateDeal test",
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "vendor_member_invitation_resent",
      targetId: activeMember.id,
      after: { email: activeMember.user.email, role: activeMember.role, status: activeMember.status },
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/security");
    expect(mocks.redirect).toHaveBeenCalledWith("/settings/security?updated=member_invitation_resent");
    expect(mocks.revalidatePath.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.redirect.mock.invocationCallOrder[0],
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it("does not email or modify data when the invitation limit is exceeded", async () => {
    mocks.vendorMemberFindFirst.mockResolvedValueOnce(activeMember);
    mocks.checkRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));

    await expect(resendVendorMemberInvitationAction(resendVendorMemberInvitationFormData())).rejects.toThrow(
      "redirect:/settings/security?error=member_invitation_rate_limited",
    );

    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it("audits a failed resend without changing the member or sessions", async () => {
    mocks.vendorMemberFindFirst.mockResolvedValueOnce(activeMember);
    mocks.sendPasswordResetLink.mockRejectedValueOnce(new Error("email delivery failed"));

    await expect(resendVendorMemberInvitationAction(resendVendorMemberInvitationFormData())).rejects.toThrow(
      "redirect:/settings/security?error=member_invitation_resend_failed",
    );

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "vendor_member_invitation_resend_email_failed",
      targetId: activeMember.id,
    }));
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });
});

describe("/settings/security member invitation controls", () => {
  it("renders resend controls only for an owner's active, non-self members", async () => {
    const activeMember = {
      id: "member-2",
      vendorId: "vendor-1",
      userId: "user-2",
      role: "accountant",
      status: "active",
      user: { id: "user-2", email: "member@example.com", platformRole: "none" },
    };
    mocks.requireAuth.mockResolvedValueOnce({
      user: { id: "owner-1", email: "owner@example.com", mfaFactor: null, recoveryCodes: [] },
      vendor: { id: "vendor-1" },
      member: { role: "owner" },
      session: { id: "session-1" },
      isMfaVerified: false,
    });
    mocks.cookies.mockResolvedValueOnce({ get: vi.fn() });
    mocks.vendorMemberFindMany.mockResolvedValueOnce([
      { ...activeMember, user: { ...activeMember.user, name: "可重寄成員" } },
      { ...activeMember, id: "member-self", userId: "owner-1", user: { id: "owner-1", email: "owner@example.com", name: "Owner", platformRole: "none" } },
      { ...activeMember, id: "member-inactive", status: "inactive", user: { ...activeMember.user, name: "停用成員" } },
    ]);

    const page = await SecuritySettingsPage({ searchParams: Promise.resolve({}) });
    const resendActions = formActions(page).filter((action) => action === resendVendorMemberInvitationAction);

    expect(resendActions).toHaveLength(1);
  });
});

describe("importSystemRolesAction", () => {
  it("validates CSRF and the vendor, then imports only system roles that do not already exist", async () => {
    const formData = new FormData();
    const existingNames = ["開場 AI 主持人", "客服 Q&A 助手"];
    mocks.requireVendor.mockResolvedValue({ id: "vendor-9" });
    mocks.interactionRoleFindMany.mockResolvedValue(existingNames.map((name) => ({ name })));

    await expect(importSystemRolesAction(formData)).rejects.toThrow("redirect:/interaction-roles");

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(formData);
    expect(mocks.requireVendor).toHaveBeenCalledOnce();
    expect(mocks.interactionRoleFindMany).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-9",
        name: { in: expect.arrayContaining(existingNames) },
      },
      select: { name: true },
    });
    expect(mocks.interactionRoleCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ name: "官方商品顧問", vendorId: "vendor-9", isActive: true }),
        expect.objectContaining({ name: "優惠提醒助手", vendorId: "vendor-9", isActive: true }),
        expect.objectContaining({ name: "保養知識顧問", vendorId: "vendor-9", isActive: true }),
        expect.objectContaining({ name: "成交節奏助手", vendorId: "vendor-9", isActive: true }),
        expect.objectContaining({ name: "直播小編", vendorId: "vendor-9", isActive: true }),
        expect.objectContaining({ name: "提醒通知助手", vendorId: "vendor-9", isActive: true }),
        expect.objectContaining({ name: "售後關懷助手", vendorId: "vendor-9", isActive: true }),
        expect.objectContaining({ name: "限時活動主持", vendorId: "vendor-9", isActive: true }),
      ]),
    });
    const [[{ data: createdRoles }]] = mocks.interactionRoleCreateMany.mock.calls;
    expect(createdRoles).toHaveLength(8);
    expect(createdRoles).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "開場 AI 主持人" }),
      expect.objectContaining({ name: "客服 Q&A 助手" }),
    ]));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/interaction-roles");
    expect(mocks.redirect).toHaveBeenCalledWith("/interaction-roles");
    expect(mocks.revalidatePath.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.redirect.mock.invocationCallOrder[0],
    );
  });

  it("does not create duplicate roles when the entire system library already exists", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.interactionRoleFindMany.mockResolvedValue([
      "開場 AI 主持人",
      "官方商品顧問",
      "優惠提醒助手",
      "客服 Q&A 助手",
      "保養知識顧問",
      "成交節奏助手",
      "直播小編",
      "提醒通知助手",
      "售後關懷助手",
      "限時活動主持",
    ].map((name) => ({ name })));

    await expect(importSystemRolesAction(new FormData())).rejects.toThrow("redirect:/interaction-roles");

    expect(mocks.interactionRoleCreateMany).toHaveBeenCalledWith({ data: [] });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/interaction-roles");
    expect(mocks.redirect).toHaveBeenCalledWith("/interaction-roles");
  });
});

describe("upsertInteractionScriptAction", () => {
  it.each(["-1", "60:00", "00:60", "00:00:60", "not-a-time", "00:00:00:00"])(
    "rejects the invalid interaction timestamp %s before saving the script",
    async (triggerSec) => {
      mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });

      await expect(upsertInteractionScriptAction(interactionScriptFormData(triggerSec))).rejects.toThrow(
        "時間必須為非負整數秒數、MM:SS 或 HH:MM:SS，且分鐘與秒數不可超過 59。",
      );

      expect(mocks.interactionScriptCreate).not.toHaveBeenCalled();
      expect(mocks.interactionScriptUpdate).not.toHaveBeenCalled();
      expect(mocks.interactionEventCreate).not.toHaveBeenCalled();
      expect(mocks.interactionEventDeleteMany).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );
});

describe("generateSettlementAction", () => {
  it("rejects an invalid settlement month before database access or side effects", async () => {
    await expect(generateSettlementAction(settlementFormData("2026-13"))).rejects.toThrow(
      "redirect:/admin/billing/settlements?error=missing",
    );

    expect(mocks.vendorFindUnique).not.toHaveBeenCalled();
    expect(mocks.settlementFindUnique).not.toHaveBeenCalled();
    expect(mocks.calculateSettlement).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.settlementUpsert).not.toHaveBeenCalled();
    expect(mocks.invoiceUpsert).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("generates a settlement and invoice for a valid settlement month", async () => {
    const settlement = { id: "settlement-1" };
    mocks.settlementUpsert.mockResolvedValue(settlement);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      settlement: { upsert: mocks.settlementUpsert },
      invoice: { upsert: mocks.invoiceUpsert },
    }));

    await expect(generateSettlementAction(settlementFormData("2026-12"))).rejects.toThrow(
      "redirect:/admin/billing/settlements",
    );

    expect(mocks.calculateSettlement).toHaveBeenCalledWith("vendor-1", "2026-12");
    expect(mocks.settlementUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId_monthKey: { vendorId: "vendor-1", monthKey: "2026-12" } },
      create: expect.objectContaining({ monthKey: "2026-12" }),
    }));
    expect(mocks.invoiceUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ monthKey: "2026-12" }),
    }));
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "generate_settlement",
      targetId: settlement.id,
    }));
  });
});

describe("refundPaymentTransactionAction", () => {
  it("rejects an invalid settlement month without creating a refund, updating the transaction, or writing an audit log", async () => {
    await expect(refundPaymentTransactionAction(refundFormData("1", "0", "0", "2026-13"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.refundRecordCreate).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("writes a valid settlement month to the RefundRecord", async () => {
    await expect(refundPaymentTransactionAction(refundFormData("1", "0", "0", "2026-12"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(mocks.refundRecordCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ monthKey: "2026-12" }),
    });
  });

  it("rejects a refund that exceeds the remaining refundable amount without writing records or updating the transaction", async () => {
    await expect(refundPaymentTransactionAction(refundFormData("40.01"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: transaction.id } });
    expect(mocks.refundRecordCreate).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("records a refund equal to the remaining refundable amount and marks the transaction refunded", async () => {
    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(mocks.refundRecordCreate).toHaveBeenCalledWith({
      data: {
        vendorId: transaction.vendorId,
        paymentTransactionId: transaction.id,
        monthKey: "2026-07",
        refundAmountCents: 4_000,
        gatewayFeeRefundCents: 0,
        platformFeeRefundCents: 0,
        reason: null,
      },
    });
    expect(mocks.paymentTransactionUpdate).toHaveBeenCalledWith({
      where: { id: transaction.id },
      data: expect.objectContaining({
        status: "refunded",
        refundedAmountCents: transaction.grossAmountCents,
      }),
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it.each([
    ["gateway", "-0.01", "0"],
    ["platform", "0", "-0.01"],
  ])("rejects a refund with a negative %s fee without writing records or updating the transaction", async (_feeType, gatewayFeeRefund, platformFeeRefund) => {
    await expect(refundPaymentTransactionAction(refundFormData("1", gatewayFeeRefund, platformFeeRefund))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(mocks.refundRecordAggregate).not.toHaveBeenCalled();
    expect(mocks.refundRecordCreate).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects a fee refund that exceeds the remaining fee balance without writing records or updating the transaction", async () => {
    mocks.refundRecordAggregate.mockResolvedValue({
      _sum: { gatewayFeeRefundCents: 600, platformFeeRefundCents: 100 },
    });

    await expect(refundPaymentTransactionAction(refundFormData("1", "4.01", "0"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(mocks.refundRecordAggregate).toHaveBeenCalledWith({
      where: { paymentTransactionId: transaction.id, status: "processed" },
      _sum: { gatewayFeeRefundCents: true, platformFeeRefundCents: true },
    });
    expect(mocks.refundRecordCreate).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("records fee refunds that exactly equal the remaining fee balances", async () => {
    mocks.refundRecordAggregate.mockResolvedValue({
      _sum: { gatewayFeeRefundCents: 600, platformFeeRefundCents: 100 },
    });

    await expect(refundPaymentTransactionAction(refundFormData("1", "4", "3"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(mocks.refundRecordCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        gatewayFeeRefundCents: 400,
        platformFeeRefundCents: 300,
      }),
    });
    expect(mocks.paymentTransactionUpdate).toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalled();
  });

  it("rolls back all writes and returns the refund error when PostgreSQL rejects a stale serializable transaction", async () => {
    const attemptedRefundRecords: unknown[] = [];
    const attemptedPaymentTransactions: unknown[] = [];
    const committedRefundRecords: unknown[] = [];
    const committedPaymentTransactions: unknown[] = [];

    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const stagedRefundRecords: unknown[] = [];
      const stagedPaymentTransactions: unknown[] = [];
      await callback({
        paymentTransaction: {
          findUnique: mocks.findUnique,
          update: async (args: unknown) => {
            attemptedPaymentTransactions.push(args);
            stagedPaymentTransactions.push(args);
            return { ...transaction, refundedAmountCents: 10_000, status: "refunded" };
          },
        },
        refundRecord: {
          aggregate: mocks.refundRecordAggregate,
          create: async (args: unknown) => {
            attemptedRefundRecords.push(args);
            stagedRefundRecords.push(args);
          },
        },
      });

      // PostgreSQL detects that the transaction read stale data at commit time.
      const shouldAbortAtCommit = () => true;
      if (shouldAbortAtCommit()) {
        throw Object.assign(new Error("serialization failure"), { code: "P2034" });
      }

      // A successful transaction would commit staged writes here.
      committedRefundRecords.push(...stagedRefundRecords);
      committedPaymentTransactions.push(...stagedPaymentTransactions);
    });

    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(attemptedRefundRecords).toHaveLength(3);
    expect(attemptedPaymentTransactions).toHaveLength(3);
    expect(committedRefundRecords).toEqual([]);
    expect(committedPaymentTransactions).toEqual([]);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("retries a P2034 serialization conflict and writes an audit log only after the successful commit", async () => {
    const attemptedRefundRecords: unknown[] = [];
    const attemptedPaymentTransactions: unknown[] = [];
    const committedRefundRecords: unknown[] = [];
    const committedPaymentTransactions: unknown[] = [];
    const events: string[] = [];
    let transactionAttempts = 0;

    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionAttempts += 1;
      const stagedRefundRecords: unknown[] = [];
      const stagedPaymentTransactions: unknown[] = [];
      const result = await callback({
        paymentTransaction: {
          findUnique: mocks.findUnique,
          update: async (args: unknown) => {
            attemptedPaymentTransactions.push(args);
            stagedPaymentTransactions.push(args);
            return { ...transaction, refundedAmountCents: 10_000, status: "refunded" };
          },
        },
        refundRecord: {
          aggregate: mocks.refundRecordAggregate,
          create: async (args: unknown) => {
            attemptedRefundRecords.push(args);
            stagedRefundRecords.push(args);
          },
        },
      });

      if (transactionAttempts === 1) {
        throw Object.assign(new Error("serialization failure"), { code: "P2034" });
      }

      committedRefundRecords.push(...stagedRefundRecords);
      committedPaymentTransactions.push(...stagedPaymentTransactions);
      events.push("committed");
      return result;
    });
    mocks.writeAuditLog.mockImplementation(async () => {
      events.push("audit");
    });

    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(attemptedRefundRecords).toHaveLength(2);
    expect(attemptedPaymentTransactions).toHaveLength(2);
    expect(committedRefundRecords).toHaveLength(1);
    expect(committedPaymentTransactions).toHaveLength(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["committed", "audit"]);
  });
});
