import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyVerifiedPaymentMethodSetup,
  PaymentMethodReferenceValidationError,
  PaymentMethodSetupConflictError,
} from "@/lib/payment-method-reference";

const db = {
  vendor: { findUnique: vi.fn() },
  teamMembership: { findFirst: vi.fn() },
  paymentMethodReference: { findUnique: vi.fn(), upsert: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.vendor.findUnique.mockResolvedValue({ id: "vendor-1" });
  db.teamMembership.findFirst.mockResolvedValue({ id: "membership-1" });
  db.paymentMethodReference.findUnique.mockResolvedValue(null);
  db.paymentMethodReference.upsert.mockResolvedValue({ id: "reference-1", status: "verified" });
});

const base = {
  providerName: "payuni",
  eventId: "setup-event-1",
  vendorId: "vendor-1",
  scopeType: "VENDOR" as const,
  providerCustomerRef: "customer_ref",
  providerPaymentMethodRef: "method_ref",
  verifiedAt: "2026-08-07T12:00:00.000Z",
  expiresAt: null,
};

describe("applyVerifiedPaymentMethodSetup", () => {
  it("stores only a verified opaque reference and records validation time", async () => {
    await applyVerifiedPaymentMethodSetup(db, base);

    expect(db.vendor.findUnique).toHaveBeenCalledWith({ where: { id: "vendor-1" }, select: { id: true } });
    expect(db.paymentMethodReference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId_providerName_providerPaymentMethodRef: {
        vendorId: "vendor-1",
        providerName: "payuni",
        providerPaymentMethodRef: "method_ref",
      } },
      create: expect.objectContaining({ status: "verified", lastValidatedAt: new Date("2026-08-07T12:00:00.000Z") }),
    }));
  });

  it("revalidates the current vendor membership before accepting a member reference", async () => {
    await applyVerifiedPaymentMethodSetup(db, {
      ...base,
      scopeType: "MEMBERSHIP",
      teamId: "team-1",
      membershipId: "membership-1",
    });

    expect(db.teamMembership.findFirst).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", teamId: "team-1", id: "membership-1", status: "ACTIVE", leftAt: null },
      select: { id: true },
    });
  });

  it("rejects invalid dates and cross-scope reuse of an existing provider reference", async () => {
    await expect(applyVerifiedPaymentMethodSetup(db, { ...base, verifiedAt: "not-a-date" }))
      .rejects.toBeInstanceOf(PaymentMethodReferenceValidationError);

    db.paymentMethodReference.findUnique.mockResolvedValue({
      vendorId: "vendor-1",
      scopeType: "MEMBERSHIP",
      teamId: "team-1",
      membershipId: "membership-1",
    });
    await expect(applyVerifiedPaymentMethodSetup(db, base)).rejects.toBeInstanceOf(PaymentMethodSetupConflictError);
    expect(db.paymentMethodReference.upsert).not.toHaveBeenCalled();
  });
});
