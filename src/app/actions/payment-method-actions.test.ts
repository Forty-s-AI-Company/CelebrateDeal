import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorFinance: vi.fn(),
  membershipFindFirst: vi.fn(),
  referenceFindUnique: vi.fn(),
  referenceUpdate: vi.fn(),
  getPaymentProvider: vi.fn(),
  getCanonicalAppUrl: vi.fn(),
  revalidatePath: vi.fn(),
  writeAuditLog: vi.fn(),
  createIntent: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireVendorFinance }));
vi.mock("@/lib/db", () => ({ getDb: () => ({
  teamMembership: { findFirst: mocks.membershipFindFirst },
  paymentMethodReference: { findUnique: mocks.referenceFindUnique, update: mocks.referenceUpdate },
}) }));
vi.mock("@/lib/payment-providers", () => ({ getPaymentProvider: mocks.getPaymentProvider }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: mocks.getCanonicalAppUrl }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/payment-method-setup-intent", () => ({
  createPaymentMethodSetupIntent: mocks.createIntent,
  PaymentMethodSetupIntentRejectedError: class PaymentMethodSetupIntentRejectedError extends Error {},
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { revokePaymentMethodReferenceAction, startPaymentMethodSetupAction } from "@/app/actions/payment-method-actions";

function form(values: Record<string, string>) {
  const data = new FormData();
  data.set("_csrf", "synthetic-csrf");
  data.set("setupConsent", "yes");
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.requireVendorFinance.mockResolvedValue({
    vendor: { id: "vendor-current", name: "測試商家" },
    member: { id: "member-current", role: "owner" },
  });
  mocks.membershipFindFirst.mockResolvedValue({ id: "membership-current" });
  mocks.getCanonicalAppUrl.mockReturnValue("http://localhost:31023");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  mocks.createIntent.mockResolvedValue({ intentId: "intent-1", setupNonce: "synthetic-nonce" });
  mocks.getPaymentProvider.mockReturnValue({ id: "demo" });
  mocks.referenceFindUnique.mockResolvedValue({
    id: "reference-1",
    vendorId: "vendor-current",
    scopeType: "VENDOR",
    teamId: null,
    membershipId: null,
    providerName: "payuni",
    providerCustomerRef: null,
    providerPaymentMethodRef: "bind-token-001",
    status: "verified",
    verifiedAt: new Date("2026-08-07T00:00:00.000Z"),
    expiresAt: null,
    lastValidatedAt: new Date("2026-08-07T00:00:00.000Z"),
  });
  mocks.referenceUpdate.mockResolvedValue({
    id: "reference-1",
    vendorId: "vendor-current",
    scopeType: "VENDOR",
    teamId: null,
    membershipId: null,
    providerName: "payuni",
    providerCustomerRef: null,
    providerPaymentMethodRef: "bind-token-001",
    status: "revoked",
    verifiedAt: new Date("2026-08-07T00:00:00.000Z"),
    expiresAt: null,
    lastValidatedAt: new Date("2026-08-07T00:00:00.000Z"),
  });
});

describe("startPaymentMethodSetupAction", () => {
  it("shows an explicit unsupported state when the configured provider has no setup adapter", async () => {
    await expect(startPaymentMethodSetupAction(form({ scopeType: "VENDOR" }))).rejects.toThrow(
      "redirect:/billing/payment-methods?error=provider_setup_unsupported",
    );
    expect(mocks.getCanonicalAppUrl).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("requires explicit setup consent before creating an intent", async () => {
    await expect(startPaymentMethodSetupAction(form({ scopeType: "VENDOR", setupConsent: "" }))).rejects.toThrow(
      "redirect:/billing/payment-methods?error=consent_required",
    );
    expect(mocks.createIntent).not.toHaveBeenCalled();
  });

  it("checks membership ownership and active status before calling the provider", async () => {
    mocks.membershipFindFirst.mockResolvedValue(null);
    mocks.getPaymentProvider.mockReturnValue({
      id: "payuni",
      createPaymentMethodSetupSession: vi.fn(),
    });

    await expect(startPaymentMethodSetupAction(form({
      scopeType: "MEMBERSHIP",
      teamId: "team-current",
      membershipId: "membership-other-vendor",
    }))).rejects.toThrow("redirect:/billing/payment-methods?error=invalid_scope");

    expect(mocks.membershipFindFirst).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-current",
        teamId: "team-current",
        id: "membership-other-vendor",
        status: "ACTIVE",
        leftAt: null,
      },
      select: { id: true },
    });
  });

  it("rejects unapproved provider redirects even when their URLs are HTTPS", async () => {
    const setup = vi.fn().mockResolvedValue({
      provider: "payuni",
      mode: "redirect",
      setupUrl: "https://payuni.example/setup?session=opaque",
      formPayload: { token: "must-not-be-stored" },
      nextAction: "complete provider verification",
    });
    mocks.getPaymentProvider.mockReturnValue({
      id: "payuni",
      createPaymentMethodSetupSession: setup,
      verifyPaymentMethodSetupSignature: vi.fn(),
      normalizePaymentMethodSetupPayload: vi.fn(),
    });

    await expect(startPaymentMethodSetupAction(form({ scopeType: "VENDOR", actorId: "forged-actor" }))).rejects.toThrow(
      "redirect:/billing/payment-methods?error=provider_setup_unsupported",
    );
    expect(setup).toHaveBeenCalledWith(expect.objectContaining({
      intentId: "intent-1",
      setupNonce: "synthetic-nonce",
      vendor: { id: "vendor-current", name: "測試商家" },
      scopeType: "VENDOR",
      appUrl: "http://localhost:31023",
      returnPath: "/billing/payment-methods",
    }));
    expect(mocks.createIntent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      vendorId: "vendor-current", consentActorId: "member-current",
    }));
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not silently send a provider form-post or manual response", async () => {
    mocks.getPaymentProvider.mockReturnValue({
      id: "payuni",
      createPaymentMethodSetupSession: vi.fn().mockResolvedValue({
        provider: "payuni",
        mode: "form_post",
        setupUrl: null,
        formAction: "https://sandbox-api.payuni.com.tw/api/upp",
        formMethod: "POST",
        formPayload: { token: "must-not-be-rendered" },
        nextAction: "complete provider verification",
      }),
      verifyPaymentMethodSetupSignature: vi.fn(),
      normalizePaymentMethodSetupPayload: vi.fn(),
    });

    await expect(startPaymentMethodSetupAction(form({ scopeType: "VENDOR" }))).resolves.toEqual({
      mode: "form_post",
      formAction: "https://sandbox-api.payuni.com.tw/api/upp",
      formPayload: { token: "must-not-be-rendered" },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("revokePaymentMethodReferenceAction", () => {
  it("revokes locally, confirms the provider cancellation, and records a sanitized audit", async () => {
    const revoke = vi.fn().mockResolvedValue({});
    mocks.getPaymentProvider.mockReturnValue({ id: "payuni", revokePaymentMethodReference: revoke });

    await expect(revokePaymentMethodReferenceAction(form({ referenceId: "reference-1" }))).rejects.toThrow(
      "redirect:/billing/payment-methods?status=revoked",
    );
    expect(mocks.referenceUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "revoked" } }));
    expect(revoke).toHaveBeenCalledWith({ providerPaymentMethodRef: "bind-token-001", providerCustomerRef: null });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "revoke_payment_method_reference",
      after: expect.objectContaining({ status: "revoked", remoteCancellation: "confirmed" }),
    }));
  });

  it("keeps the local fail-closed state when provider cancellation fails", async () => {
    mocks.getPaymentProvider.mockReturnValue({
      id: "payuni",
      revokePaymentMethodReference: vi.fn().mockRejectedValue(new Error("provider failure")),
    });

    await expect(revokePaymentMethodReferenceAction(form({ referenceId: "reference-1" }))).rejects.toThrow(
      "redirect:/billing/payment-methods?error=provider_revoke_failed",
    );
    expect(mocks.referenceUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "revoked" } }));
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      after: expect.objectContaining({ remoteCancellation: "failed" }),
    }));
  });
});
