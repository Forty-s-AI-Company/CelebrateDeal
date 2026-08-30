import { describe, expect, it, vi } from "vitest";
import {
  assertPaymentMethodReferenceForQuota,
  normalizePaymentMethodReference,
  PaymentMethodReferenceNotFoundError,
  PaymentMethodReferenceRequiredError,
  PaymentMethodReferenceValidationError,
  revokePaymentMethodReference,
} from "./payment-method-reference";

const verifiedAt = new Date("2026-08-07T00:00:00.000Z");

describe("payment method reference contract", () => {
  it("normalizes only opaque provider references and keeps verified time", () => {
    expect(normalizePaymentMethodReference({
      vendorId: "vendor-1",
      scopeType: "MEMBERSHIP",
      teamId: "team-1",
      membershipId: "member-1",
      providerName: "PayUni-Sandbox",
      providerCustomerRef: "cus_demo_1",
      providerPaymentMethodRef: "pm_demo_1",
      status: "verified",
      verifiedAt,
    })).toEqual({
      vendorId: "vendor-1",
      scopeType: "MEMBERSHIP",
      teamId: "team-1",
      membershipId: "member-1",
      providerName: "payuni-sandbox",
      providerCustomerRef: "cus_demo_1",
      providerPaymentMethodRef: "pm_demo_1",
      status: "verified",
      verifiedAt,
      expiresAt: null,
    });
  });

  it.each([
    { providerPaymentMethodRef: "4111111111111111" },
    { providerPaymentMethodRef: "pm with spaces" },
    { providerPaymentMethodRef: "pm_demo", status: "verified" as const },
    { providerPaymentMethodRef: "pm_demo", scopeType: "MEMBERSHIP" as const, teamId: null, membershipId: "member-1" },
    { providerPaymentMethodRef: "pm_demo", scopeType: "UNSUPPORTED" as never },
  ])("rejects unsafe or incomplete reference input", (override) => {
    const base = {
      vendorId: "vendor-1",
      scopeType: "VENDOR",
      providerName: "payuni",
      providerPaymentMethodRef: "pm_demo",
    } as const;
    expect(() => normalizePaymentMethodReference({ ...base, ...override })).toThrow(PaymentMethodReferenceValidationError);
  });

  it("requires an active vendor reference for vendor-paid quota", async () => {
    const db = {
      paymentMethodReference: {
        findFirst: vi.fn().mockResolvedValue({ status: "verified", verifiedAt, expiresAt: null }),
        findMany: vi.fn(),
      },
    };
    await expect(assertPaymentMethodReferenceForQuota(db as never, {
      vendorId: "vendor-1",
      payerScope: "VENDOR",
      memberIds: [],
      now: new Date("2026-08-07T01:00:00.000Z"),
    })).resolves.toBeUndefined();
    expect(db.paymentMethodReference.findFirst).toHaveBeenCalledOnce();
  });

  it("requires every configured member to have an active reference", async () => {
    const db = {
      paymentMethodReference: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          { membershipId: "member-1", status: "verified", verifiedAt, expiresAt: null },
          { membershipId: "member-2", status: "verified", verifiedAt, expiresAt: new Date("2026-08-07T00:30:00.000Z") },
        ]),
      },
    };
    await expect(assertPaymentMethodReferenceForQuota(db as never, {
      vendorId: "vendor-1",
      payerScope: "MEMBER",
      memberIds: ["member-1", "member-2"],
      now: new Date("2026-08-07T01:00:00.000Z"),
    })).rejects.toBeInstanceOf(PaymentMethodReferenceRequiredError);
  });

  it("revokes a vendor-scoped reference before any provider-side cancellation", async () => {
    const reference = {
      id: "reference-1",
      vendorId: "vendor-1",
      scopeType: "VENDOR",
      teamId: null,
      membershipId: null,
      providerName: "payuni",
      providerCustomerRef: null,
      providerPaymentMethodRef: "bind-token-001",
      status: "verified",
      verifiedAt,
      expiresAt: null,
      lastValidatedAt: verifiedAt,
    };
    const db = {
      paymentMethodReference: {
        findUnique: vi.fn().mockResolvedValue(reference),
        update: vi.fn().mockResolvedValue({ ...reference, status: "revoked" }),
      },
    };

    await expect(revokePaymentMethodReference(db, { vendorId: "vendor-1", referenceId: "reference-1" }))
      .resolves.toMatchObject({ changed: true, reference: { status: "revoked" } });
    expect(db.paymentMethodReference.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId_id: { vendorId: "vendor-1", id: "reference-1" } },
      data: { status: "revoked" },
    }));
  });

  it("is idempotent for an already revoked reference and fails closed for another vendor", async () => {
    const revoked = {
      id: "reference-1",
      vendorId: "vendor-1",
      scopeType: "VENDOR",
      teamId: null,
      membershipId: null,
      providerName: "payuni",
      providerCustomerRef: null,
      providerPaymentMethodRef: "bind-token-001",
      status: "revoked",
      verifiedAt,
      expiresAt: null,
      lastValidatedAt: verifiedAt,
    };
    const db = {
      paymentMethodReference: {
        findUnique: vi.fn().mockResolvedValueOnce(revoked).mockResolvedValueOnce(null),
        update: vi.fn(),
      },
    };

    await expect(revokePaymentMethodReference(db, { vendorId: "vendor-1", referenceId: "reference-1" }))
      .resolves.toMatchObject({ changed: false, reference: revoked });
    await expect(revokePaymentMethodReference(db, { vendorId: "vendor-2", referenceId: "reference-1" }))
      .rejects.toBeInstanceOf(PaymentMethodReferenceNotFoundError);
    expect(db.paymentMethodReference.update).not.toHaveBeenCalled();
  });
});
