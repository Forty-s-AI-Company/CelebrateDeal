import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  product: { findFirst: vi.fn() },
  formSubmission: { findFirst: vi.fn() },
  paymentTransaction: { create: vi.fn(), update: vi.fn() },
};

const createCheckoutSession = vi.fn();

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/payment-providers", () => ({
  getPaymentProvider: () => ({ id: "demo", createCheckoutSession }),
}));

import { POST } from "@/app/api/payments/checkout/route";

function checkoutRequest(cookie?: string) {
  return new Request("https://app.example.test/api/payments/checkout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      referer: "https://app.example.test/products/product-1",
      "x-celebratedeal-client": "web",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ vendorId: "vendor-1", productId: "product-1" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.product.findFirst.mockResolvedValue({
    id: "product-1",
    name: "Test product",
    vendorId: "vendor-1",
    inventory: 3,
    priceCents: 1200,
    currency: "TWD",
    vendor: { id: "vendor-1" },
  });
  db.formSubmission.findFirst.mockResolvedValue({ id: "submission-1" });
  db.paymentTransaction.create.mockResolvedValue({ id: "transaction-1" });
  db.paymentTransaction.update.mockResolvedValue({ id: "transaction-1" });
  createCheckoutSession.mockResolvedValue({
    provider: "demo",
    mode: "manual",
    checkoutUrl: null,
    nextAction: "demo_checkout_transaction_created",
  });
});

describe("checkout form submission attribution", () => {
  it("carries a same-vendor form submission cookie into transaction metadata", async () => {
    const response = await POST(checkoutRequest("celebratedeal_form_submission=submission-1"));

    expect(response.status).toBe(200);
    expect(db.formSubmission.findFirst).toHaveBeenCalledWith({
      where: { id: "submission-1", form: { vendorId: "vendor-1" } },
      select: { id: true },
    });
    expect(db.paymentTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.objectContaining({ formSubmissionId: "submission-1" }) }),
    }));
    expect(db.paymentTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.objectContaining({ formSubmissionId: "submission-1" }) }),
    }));
    expect(response.headers.getSetCookie().join("\n")).toContain("celebratedeal_form_submission=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=lax");
  });

  it("ignores a cross-vendor or invalid submission cookie without blocking checkout", async () => {
    db.formSubmission.findFirst.mockResolvedValue(null);

    const response = await POST(checkoutRequest("celebratedeal_form_submission=foreign-submission"));

    expect(response.status).toBe(200);
    expect(db.paymentTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.not.objectContaining({ formSubmissionId: expect.anything() }) }),
    }));
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("checks out normally when the attribution cookie is missing", async () => {
    const response = await POST(checkoutRequest());

    expect(response.status).toBe(200);
    expect(db.formSubmission.findFirst).not.toHaveBeenCalled();
    expect(db.paymentTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.not.objectContaining({ formSubmissionId: expect.anything() }) }),
    }));
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("ignores a malformed attribution cookie without blocking checkout", async () => {
    const response = await POST(checkoutRequest("celebratedeal_form_submission=not/a-submission-id"));

    expect(response.status).toBe(200);
    expect(db.formSubmission.findFirst).not.toHaveBeenCalled();
    expect(db.paymentTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.not.objectContaining({ formSubmissionId: expect.anything() }) }),
    }));
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});
