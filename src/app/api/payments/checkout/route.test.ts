import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  product: { findFirst: vi.fn() },
  affiliateClick: { findFirst: vi.fn() },
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

function checkoutRequest(cookie?: string, body: Record<string, unknown> = { vendorId: "vendor-1", productId: "product-1" }) {
  return new Request("https://app.example.test/api/payments/checkout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      referer: "https://app.example.test/products/product-1",
      "x-celebratedeal-client": "web",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
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
  db.affiliateClick.findFirst.mockResolvedValue(null);
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

function attributionCookie(value: { clickId: string; visitorId: string; issuedAt: number }) {
  return `celebratedeal_attribution=${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
}

function expectNoAffiliateAttribution() {
  const transaction = db.paymentTransaction.create.mock.calls[0]?.[0];
  expect(transaction?.data.metadata).not.toHaveProperty("affiliateClickId");
  expect(transaction?.data.metadata).not.toHaveProperty("referralCode");
  expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
    referralCode: undefined,
  }));
}

describe("checkout affiliate click attribution", () => {
  const visitorId = "visitor-123456789012345";

  it("stores a server-verified, current same-visitor affiliate click and its resolved referral code", async () => {
    db.affiliateClick.findFirst.mockResolvedValue({
      id: "click-1",
      affiliateId: "affiliate-1",
      referralCode: "VALIDCODE",
      affiliate: { code: "VALIDCODE" },
    });

    const response = await POST(checkoutRequest(
      `${attributionCookie({ clickId: "click-1", visitorId, issuedAt: Date.now() })}; celebratedeal_visitor=${visitorId}`,
      { vendorId: "vendor-1", productId: "product-1", referralCode: "FORGEDCODE" },
    ));

    expect(response.status).toBe(200);
    expect(db.affiliateClick.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "click-1", vendorId: "vendor-1", visitorId }),
    }));
    expect(db.paymentTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: expect.objectContaining({ affiliateClickId: "click-1", referralCode: "VALIDCODE" }),
      }),
    }));
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ referralCode: "VALIDCODE" }));
  });

  it("does not use an attribution cookie for a different visitor", async () => {
    const response = await POST(checkoutRequest(
      `${attributionCookie({ clickId: "click-1", visitorId, issuedAt: Date.now() })}; celebratedeal_visitor=visitor-987654321098765`,
      { vendorId: "vendor-1", productId: "product-1", referralCode: "FORGEDCODE" },
    ));

    expect(response.status).toBe(200);
    expect(db.affiliateClick.findFirst).not.toHaveBeenCalled();
    expectNoAffiliateAttribution();
  });

  it("does not use an expired attribution cookie", async () => {
    const response = await POST(checkoutRequest(
      `${attributionCookie({ clickId: "click-1", visitorId, issuedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 })}; celebratedeal_visitor=${visitorId}`,
      { vendorId: "vendor-1", productId: "product-1", referralCode: "FORGEDCODE" },
    ));

    expect(response.status).toBe(200);
    expect(db.affiliateClick.findFirst).not.toHaveBeenCalled();
    expectNoAffiliateAttribution();
  });

  it("does not use an unknown attribution click", async () => {
    const response = await POST(checkoutRequest(
      `${attributionCookie({ clickId: "unknown-click", visitorId, issuedAt: Date.now() })}; celebratedeal_visitor=${visitorId}`,
      { vendorId: "vendor-1", productId: "product-1", referralCode: "FORGEDCODE" },
    ));

    expect(response.status).toBe(200);
    expect(db.affiliateClick.findFirst).toHaveBeenCalled();
    expectNoAffiliateAttribution();
  });

  it("does not use a forged referral code when the attribution cookie is missing", async () => {
    const response = await POST(checkoutRequest(
      undefined,
      { vendorId: "vendor-1", productId: "product-1", referralCode: "FORGEDCODE" },
    ));

    expect(response.status).toBe(200);
    expect(db.affiliateClick.findFirst).not.toHaveBeenCalled();
    expectNoAffiliateAttribution();
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

describe("checkout provider failures", () => {
  it("returns a generic 502 and does not create a provider checkout when transaction creation fails", async () => {
    const databaseError = new Error(
      "database create failed for order CD-20330101010101-ABC123 via payuni: fake-database-secret-token",
    );
    db.paymentTransaction.create.mockRejectedValue(databaseError);

    const response = await POST(checkoutRequest());
    const serializedResponse = await response.text();

    expect(response.status).toBe(502);
    expect(serializedResponse).toBe('{"error":"Unable to start checkout"}');
    expect(serializedResponse).not.toContain("CD-20330101010101-ABC123");
    expect(serializedResponse).not.toContain("payuni");
    expect(serializedResponse).not.toContain("fake-database-secret-token");
    expect(createCheckoutSession).not.toHaveBeenCalled();
    expect(db.paymentTransaction.update).not.toHaveBeenCalled();
  });

  it("returns a generic 502 after marking the transaction failed without leaking provider details", async () => {
    const providerError = new Error("provider checkout failed: fake-provider-secret-token");
    createCheckoutSession.mockRejectedValue(providerError);

    const response = await POST(checkoutRequest());
    const serializedResponse = await response.text();

    expect(response.status).toBe(502);
    expect(serializedResponse).toBe('{"error":"Unable to start checkout"}');
    expect(serializedResponse).not.toContain("fake-provider-secret-token");
    expect(db.paymentTransaction.update).toHaveBeenCalledWith({
      where: { id: "transaction-1" },
      data: { status: "failed" },
    });
    expect(db.paymentTransaction.update).toHaveBeenCalledTimes(1);
    expect(JSON.stringify({
      create: db.paymentTransaction.create.mock.calls,
      update: db.paymentTransaction.update.mock.calls,
    })).not.toContain("fake-provider-secret-token");
  });

  it("returns the same generic 502 when marking the transaction failed also fails", async () => {
    const providerError = new Error("provider checkout failed: fake-provider-secret-token");
    const databaseError = new Error("database update failed: fake-database-secret-token");
    createCheckoutSession.mockRejectedValue(providerError);
    db.paymentTransaction.update.mockRejectedValue(databaseError);

    const response = await POST(checkoutRequest());
    const serializedResponse = await response.text();

    expect(response.status).toBe(502);
    expect(serializedResponse).toBe('{"error":"Unable to start checkout"}');
    expect(serializedResponse).not.toContain("fake-provider-secret-token");
    expect(serializedResponse).not.toContain("fake-database-secret-token");
    expect(db.paymentTransaction.update).toHaveBeenCalledWith({
      where: { id: "transaction-1" },
      data: { status: "failed" },
    });
    expect(db.paymentTransaction.update).toHaveBeenCalledTimes(1);
  });

  it("marks the transaction failed and returns a generic 502 without a checkout payload when checkout-session metadata persistence fails", async () => {
    const databaseError = new Error("database update failed: fake-database-secret-token");
    db.paymentTransaction.update.mockRejectedValueOnce(databaseError);
    createCheckoutSession.mockResolvedValue({
      provider: "demo",
      mode: "redirect",
      checkoutUrl: "https://provider.example.test/checkout/fake-provider-session-token",
      nextAction: "continue_with_provider",
      externalRequired: true,
    });

    const response = await POST(checkoutRequest());
    const serializedResponse = await response.text();

    expect(response.status).toBe(502);
    expect(serializedResponse).toBe('{"error":"Unable to start checkout"}');
    expect(serializedResponse).not.toContain("fake-database-secret-token");
    expect(serializedResponse).not.toContain("fake-provider-session-token");
    expect(JSON.parse(serializedResponse)).not.toMatchObject({
      ok: true,
      provider: expect.anything(),
      orderNumber: expect.anything(),
      transactionId: expect.anything(),
      checkoutUrl: expect.anything(),
      nextAction: expect.anything(),
    });
    expect(db.paymentTransaction.update).toHaveBeenCalledTimes(2);
    expect(db.paymentTransaction.update).toHaveBeenNthCalledWith(1, {
      where: { id: "transaction-1" },
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          checkoutSession: expect.objectContaining({ provider: "demo", mode: "redirect" }),
        }),
      }),
    });
    expect(db.paymentTransaction.update).toHaveBeenNthCalledWith(2, {
      where: { id: "transaction-1" },
      data: { status: "failed" },
    });
  });

  it("returns the same generic 502 without checkout data when metadata-failure compensation also fails", async () => {
    const metadataError = new Error("metadata update failed: fake-database-secret-token");
    const compensationError = new Error("failed-status update failed: fake-compensation-secret-token");
    db.paymentTransaction.update.mockRejectedValueOnce(metadataError).mockRejectedValueOnce(compensationError);
    createCheckoutSession.mockResolvedValue({
      provider: "demo",
      mode: "redirect",
      checkoutUrl: "https://provider.example.test/checkout/fake-provider-session-token",
      nextAction: "continue_with_provider",
      externalRequired: true,
    });

    const response = await POST(checkoutRequest());
    const serializedResponse = await response.text();

    expect(response.status).toBe(502);
    expect(serializedResponse).toBe('{"error":"Unable to start checkout"}');
    expect(serializedResponse).not.toContain("fake-database-secret-token");
    expect(serializedResponse).not.toContain("fake-compensation-secret-token");
    expect(serializedResponse).not.toContain("fake-provider-session-token");
    expect(JSON.parse(serializedResponse)).not.toMatchObject({
      ok: true,
      provider: expect.anything(),
      orderNumber: expect.anything(),
      transactionId: expect.anything(),
      checkoutUrl: expect.anything(),
      nextAction: expect.anything(),
    });
    expect(db.paymentTransaction.update).toHaveBeenCalledTimes(2);
    expect(db.paymentTransaction.update).toHaveBeenNthCalledWith(2, {
      where: { id: "transaction-1" },
      data: { status: "failed" },
    });
  });
});
