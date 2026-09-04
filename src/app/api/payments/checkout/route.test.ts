import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  product: { findFirst: vi.fn() },
  affiliateClick: { findFirst: vi.fn() },
  formSubmission: { findFirst: vi.fn() },
  paymentTransaction: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
};

const inventoryMocks = vi.hoisted(() => {
  class InventoryUnavailableError extends Error {}
  class ProductChangedError extends Error {}
  class CheckoutIdempotencyConflictError extends Error {
    constructor(public readonly transactionId: string) {
      super("Checkout idempotency key is already in use.");
    }
  }
  return {
    InventoryUnavailableError,
    ProductChangedError,
    CheckoutIdempotencyConflictError,
    createReservedPaymentTransaction: vi.fn(),
    failPendingCheckoutAndReleaseInventory: vi.fn(),
  };
});

const createCheckoutSession = vi.fn();
const checkoutReadiness = vi.fn();
const paymentProviderMocks = vi.hoisted(() => ({ getPaymentProvider: vi.fn() }));
const commerceOrderMocks = vi.hoisted(() => ({ createCommerceOrderForCheckout: vi.fn() }));
const buyerSupportMocks = vi.hoisted(() => ({ issueBuyerSupportGrant: vi.fn() }));
const admissionMocks = vi.hoisted(() => ({
  checkoutSessionTokenFromRequest: vi.fn(),
  verifyCheckoutAdmission: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/payment-providers", () => ({
  getPaymentProvider: paymentProviderMocks.getPaymentProvider,
}));
vi.mock("@/lib/inventory-reservations", () => inventoryMocks);
vi.mock("@/lib/commerce-orders", () => commerceOrderMocks);
vi.mock("@/lib/buyer-support-access", () => ({
  issueBuyerSupportGrant: buyerSupportMocks.issueBuyerSupportGrant,
  buyerSupportCookieOptions: ({ expiresAt, secure }: { expiresAt: Date; secure: boolean }) => ({
    httpOnly: true, sameSite: "lax", secure, path: "/", expires: expiresAt,
  }),
}));
vi.mock("@/lib/checkout-admission", () => admissionMocks);

import { POST } from "@/app/api/payments/checkout/route";
import { createCommerceOrderIdentityHash } from "@/lib/commerce-order-pii";
import { createCustomCheckoutIdentityHash } from "@/lib/commerce-custom-checkout";
import { encodeAttributionCookie } from "@/lib/team-funnel-attribution";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";

const idempotencyKey = "123e4567-e89b-12d3-a456-426614174000";
const admissionToken = `ca1.${"a".repeat(64)}.${"b".repeat(43)}`;
const buyer = { name: "王小明", email: "buyer@example.test", phone: "0912345678" };
const shipping = {
  recipientName: "王小明",
  phone: "0912345678",
  countryCode: "TW",
  postalCode: "100",
  administrativeArea: "台北市",
  locality: "中正區",
  addressLine1: "測試路 1 號",
};

function identityHash(
  input = { buyer, shipping },
  definitions: unknown = [],
  answers: unknown = undefined,
) {
  return createCustomCheckoutIdentityHash({
    vendorId: "vendor-1",
    productId: "product-1",
    basePiiHash: createCommerceOrderIdentityHash(input, "vendor-1"),
    definitions,
    answers,
  });
}

function checkoutRequest(cookie?: string, body: Record<string, unknown> = {}, origin = "https://app.example.test") {
  return new Request(`${origin}/api/payments/checkout`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      referer: `${origin}/products/product-1`,
      "x-celebratedeal-client": "web",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({
      vendorId: "vendor-1",
      productId: "product-1",
      idempotencyKey,
      admissionToken,
      buyer,
      shipping,
      ...body,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CSRF_SECRET", "checkout-route-test-secret-that-is-at-least-32-bytes");
  db.product.findFirst.mockResolvedValue({
    id: "product-1",
    name: "Test product",
    vendorId: "vendor-1",
    inventory: 3,
    priceCents: 1200,
    currency: "TWD",
    fulfillmentType: "physical",
    commerceDomain: "merchant",
    courseContentOwnerMembershipId: null,
    coursePromoterShareBps: null,
    coursePolicyVersion: 1,
    revision: 4,
    checkoutUrl: null,
    deliveryConfig: null,
    vendor: { id: "vendor-1" },
  });
  db.affiliateClick.findFirst.mockResolvedValue(null);
  db.formSubmission.findFirst.mockResolvedValue({ id: "submission-1", liveId: "live-1" });
  db.paymentTransaction.findUnique.mockResolvedValue(null);
  db.paymentTransaction.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: "transaction-1", ...data }));
  db.paymentTransaction.update.mockResolvedValue({ id: "transaction-1" });
  checkoutReadiness.mockReturnValue("local_only");
  paymentProviderMocks.getPaymentProvider.mockReturnValue({ id: "demo", checkoutReadiness, createCheckoutSession });
  commerceOrderMocks.createCommerceOrderForCheckout.mockResolvedValue({ id: "order-1" });
  buyerSupportMocks.issueBuyerSupportGrant.mockResolvedValue({
    name: `celebrate_support_${"a".repeat(32)}`,
    value: "b".repeat(43),
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
  });
  admissionMocks.checkoutSessionTokenFromRequest.mockReturnValue("s".repeat(43));
  admissionMocks.verifyCheckoutAdmission.mockReturnValue({
    vendorId: "vendor-1",
    productId: "product-1",
    productRevision: 4,
    idempotencyKey,
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
  });
  inventoryMocks.createReservedPaymentTransaction.mockImplementation(async (
    { transactionData, createCommerceOrder }: {
      transactionData: unknown;
      createCommerceOrder?: (tx: unknown, transaction: Record<string, unknown>) => Promise<void>;
    },
  ) => {
    const transaction = await db.paymentTransaction.create({ data: transactionData });
    if (createCommerceOrder) await createCommerceOrder({ transaction: true }, transaction);
    return transaction;
  });
  inventoryMocks.failPendingCheckoutAndReleaseInventory.mockImplementation(
    ({ transactionId }: { transactionId: string }) => db.paymentTransaction.update({
      where: { id: transactionId },
      data: { status: "failed" },
    }),
  );
  createCheckoutSession.mockResolvedValue({
    provider: "demo",
    mode: "manual",
    checkoutUrl: null,
    nextAction: "demo_checkout_transaction_created",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function attributionCookie(value: { clickId: string; visitorId: string; issuedAt: number }) {
  return `celebratedeal_attribution=${encodeAttributionCookie(value)}`;
}

function expectNoAffiliateAttribution() {
  const transaction = db.paymentTransaction.create.mock.calls[0]?.[0];
  expect(transaction?.data.metadata).not.toHaveProperty("affiliateClickId");
  expect(transaction?.data.metadata).not.toHaveProperty("referralCode");
  expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
    referralCode: undefined,
  }));
}

describe("successful checkout response", () => {
  it.each([
    ["https://exact-preview.vercel.app", "https://exact-preview.vercel.app"],
    ["https://attacker.vercel.app", "https://app.example.test"],
  ])("binds payer return for request origin %s without changing canonical notifications", async (origin, expectedReturn) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PAYUNI_ENV", "sandbox");
    vi.stubEnv("VERCEL_URL", "exact-preview.vercel.app");
    const response = await POST(checkoutRequest(undefined, {}, origin));
    expect(response.status).toBe(200);
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      appUrl: "https://app.example.test",
      returnAppUrl: expectedReturn,
    }));
  });

  it("requires a bounded caller idempotency key", async () => {
    const response = await POST(checkoutRequest(undefined, { idempotencyKey: undefined }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid checkout request" });
    expect(db.product.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a direct checkout without a server-issued admission before reading products", async () => {
    admissionMocks.verifyCheckoutAdmission.mockReturnValueOnce(null);

    const response = await POST(checkoutRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Checkout admission expired or invalid" });
    expect(db.product.findFirst).not.toHaveBeenCalled();
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
  });

  it("rejects an admission rebound to another product, vendor, or idempotency key", async () => {
    for (const binding of [
      { vendorId: "vendor-2", productId: "product-1", idempotencyKey },
      { vendorId: "vendor-1", productId: "product-2", idempotencyKey },
      { vendorId: "vendor-1", productId: "product-1", idempotencyKey: "223e4567-e89b-12d3-a456-426614174000" },
    ]) {
      admissionMocks.verifyCheckoutAdmission.mockReturnValueOnce({
        ...binding,
        productRevision: 4,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      });
      const response = await POST(checkoutRequest());
      expect(response.status).toBe(409);
    }
    expect(db.product.findFirst).not.toHaveBeenCalled();
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
  });

  it("rejects a new checkout when the product revision changed after admission", async () => {
    admissionMocks.verifyCheckoutAdmission.mockReturnValueOnce({
      vendorId: "vendor-1",
      productId: "product-1",
      productRevision: 3,
      idempotencyKey,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    });

    const response = await POST(checkoutRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Product changed; reload checkout" });
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
  });

  it("fails before creating an order or reserving stock when the provider is unavailable", async () => {
    checkoutReadiness.mockReturnValueOnce("unavailable");

    const response = await POST(checkoutRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Checkout is temporarily unavailable" });
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
    expect(commerceOrderMocks.createCommerceOrderForCheckout).not.toHaveBeenCalled();
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns a bounded response without writes when the configured provider is unsupported", async () => {
    paymentProviderMocks.getPaymentProvider.mockImplementationOnce(() => {
      throw new Error("unsupported provider: synthetic-config-detail");
    });

    const response = await POST(checkoutRequest());
    const serializedResponse = await response.text();

    expect(response.status).toBe(503);
    expect(serializedResponse).toBe('{"error":"Checkout is temporarily unavailable"}');
    expect(serializedResponse).not.toContain("synthetic-config-detail");
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
    expect(commerceOrderMocks.createCommerceOrderForCheckout).not.toHaveBeenCalled();
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("does not allow the synthetic demo checkout to create production orders", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await POST(checkoutRequest());

    expect(response.status).toBe(503);
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("fails and releases the reservation when a ready provider returns no payment destination", async () => {
    checkoutReadiness.mockReturnValueOnce("ready");
    createCheckoutSession.mockResolvedValueOnce({
      provider: "payuni",
      mode: "manual",
      checkoutUrl: null,
      nextAction: "provider_checkout_adapter_pending",
      externalRequired: true,
    });

    const response = await POST(checkoutRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Unable to start checkout" });
    expect(inventoryMocks.createReservedPaymentTransaction).toHaveBeenCalledTimes(1);
    expect(inventoryMocks.failPendingCheckoutAndReleaseInventory).toHaveBeenCalledWith({
      vendorId: "vendor-1",
      transactionId: "transaction-1",
      reason: "provider_checkout_failed",
    });
    expect(db.paymentTransaction.update).toHaveBeenCalledTimes(1);
  });

  it("rejects a client-marked checkout with no same-origin evidence before reading products", async () => {
    const response = await POST(new Request("https://app.example.test/api/payments/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-celebratedeal-client": "web",
      },
      body: JSON.stringify({ vendorId: "vendor-1", productId: "product-1" }),
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Missing request origin" });
    expect(db.product.findFirst).not.toHaveBeenCalled();
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
  });

  it("prevents caching while preserving the checkout payload", async () => {
    createCheckoutSession.mockResolvedValue({
      provider: "demo",
      mode: "form_post",
      checkoutUrl: "https://provider.example.test/checkout/fake-provider-session-token",
      formAction: "https://provider.example.test/submit",
      formMethod: "POST",
      formPayload: { MerchantOrderNo: "example-order", HashKey: "fake-form-payload-value" },
      nextAction: "submit_provider_form",
      externalRequired: true,
    });

    const response = await POST(checkoutRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain(`celebrate_support_${"a".repeat(32)}`);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(buyerSupportMocks.issueBuyerSupportGrant).toHaveBeenCalledWith(db, expect.objectContaining({
      vendorId: "vendor-1", orderId: "order-1",
    }));
    await expect(response.json()).resolves.toStrictEqual({
      ok: true,
      provider: "demo",
      orderNumber: expect.stringMatching(/^CD-\d{14}-[A-Z0-9]{6}$/),
      transactionId: "transaction-1",
      amountCents: 1200,
      currency: "TWD",
      checkoutUrl: "https://provider.example.test/checkout/fake-provider-session-token",
      formAction: "https://provider.example.test/submit",
      formMethod: "POST",
      formPayload: { MerchantOrderNo: "example-order", HashKey: "fake-form-payload-value" },
      nextAction: "submit_provider_form",
      externalRequired: true,
    });
  });

  it("only starts checkout for an active product owned by the requested vendor", async () => {
    const response = await POST(checkoutRequest());

    expect(response.status).toBe(200);
    expect(db.product.findFirst).toHaveBeenCalledWith({
      where: {
        id: "product-1",
        vendorId: "vendor-1",
        isActive: true,
        fulfillmentTypeConfirmed: true,
        priceCents: { gt: 0 },
      },
      include: {
        vendor: true,
        deliveryConfig: { select: { id: true, status: true, fulfillmentType: true } },
      },
    });
  });

  it("fails closed when an external-checkout product calls the internal payment API", async () => {
    db.product.findFirst.mockResolvedValueOnce({ ...(await db.product.findFirst()), checkoutUrl: "https://external.example.test/buy" });
    const response = await POST(checkoutRequest());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "External checkout required" });
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("fails before stock reservation when a non-physical product has no active delivery config", async () => {
    db.product.findFirst.mockResolvedValueOnce({
      ...(await db.product.findFirst()),
      fulfillmentType: "digital",
      deliveryConfig: null,
    });

    const response = await POST(checkoutRequest(undefined, { shipping: null }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Product delivery is not ready" });
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("asks the buyer to reload when the product changes before stock reservation", async () => {
    inventoryMocks.createReservedPaymentTransaction.mockRejectedValueOnce(new inventoryMocks.ProductChangedError());
    const response = await POST(checkoutRequest());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Product changed; reload checkout" });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("validates fulfillment-specific PII before reserving stock", async () => {
    const missingShipping = await POST(checkoutRequest(undefined, { shipping: null }));
    expect(missingShipping.status).toBe(400);

    const malformedBuyer = await POST(checkoutRequest(undefined, {
      buyer: { name: "王小明", email: "not-an-email", phone: "0912345678" },
    }));
    expect(malformedBuyer.status).toBe(400);
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
  });

  it("creates the canonical order inside the stock/payment transaction without plaintext PII metadata", async () => {
    const response = await POST(checkoutRequest());

    expect(response.status).toBe(200);
    expect(commerceOrderMocks.createCommerceOrderForCheckout).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        vendorId: "vendor-1",
        productId: "product-1",
        paymentTransactionId: "transaction-1",
        buyer,
        shipping,
      }),
    );
    const metadata = db.paymentTransaction.create.mock.calls[0]?.[0]?.data?.metadata;
    expect(JSON.stringify(metadata)).not.toContain(buyer.email);
    expect(JSON.stringify(metadata)).not.toContain(shipping.addressLine1);
    expect(inventoryMocks.createReservedPaymentTransaction).toHaveBeenCalledWith(expect.objectContaining({ expectedProductRevision: 4 }));
  });

  it("persists only the server-owned source marker for a synthetic Preview checkout", async () => {
    const source = "a".repeat(40);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PAYUNI_ENV", "sandbox");
    vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", source);
    vi.stubEnv("WP4_EXPECTED_SOURCE_SHA", "");
    checkoutReadiness.mockReturnValue("ready");
    createCheckoutSession.mockResolvedValue({
      provider: "demo", mode: "redirect", checkoutUrl: "https://checkout.example.test/synthetic",
    });
    db.product.findFirst.mockResolvedValue({
      ...(await db.product.findFirst()), id: WP4_SANDBOX_FIXTURE.productId,
    });
    admissionMocks.verifyCheckoutAdmission.mockReturnValue({
      vendorId: "vendor-1", productId: WP4_SANDBOX_FIXTURE.productId,
      productRevision: 4, idempotencyKey, expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    });
    const response = await POST(checkoutRequest(undefined, {
      productId: WP4_SANDBOX_FIXTURE.productId,
    }));
    expect(response.status).toBe(200);
    expect(db.paymentTransaction.create.mock.calls[0]?.[0]?.data?.metadata).toMatchObject({
      billingPurpose: "buyer_order", wp4SourceCommit: source,
    });
    expect(db.paymentTransaction.update.mock.calls[0]?.[0]?.data?.metadata).toMatchObject({
      billingPurpose: "buyer_order", wp4SourceCommit: source,
    });
  });

  it("rejects caller-owned source and purpose before any transaction write", async () => {
    const response = await POST(checkoutRequest(undefined, {
      wp4SourceCommit: "b".repeat(40), billingPurpose: "invoice_payment",
    }));
    expect(response.status).toBe(400);
    expect(db.paymentTransaction.create).not.toHaveBeenCalled();
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("strictly validates custom answers from the database definition and never writes them to transaction metadata", async () => {
    db.product.findFirst.mockResolvedValueOnce({
      ...(await db.product.findFirst()),
      customCheckoutFields: [{ key: "engraving", label: "刻字內容", type: "text", required: true }],
    });
    const response = await POST(checkoutRequest(undefined, { customCheckoutAnswers: { engraving: "生日快樂" } }));
    expect(response.status).toBe(200);
    expect(commerceOrderMocks.createCommerceOrderForCheckout).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ customCheckoutAnswers: { engraving: "生日快樂" } }));
    expect(JSON.stringify(db.paymentTransaction.create.mock.calls[0]?.[0]?.data?.metadata)).not.toContain("生日快樂");

    const invalid = await POST(checkoutRequest(undefined, { customCheckoutAnswers: { engraving: "生日快樂", forged: "x" } }));
    expect(invalid.status).toBe(400);
    expect(inventoryMocks.createReservedPaymentTransaction).toHaveBeenCalledTimes(1);
  });

  it("locks a course policy snapshot into trusted checkout metadata", async () => {
    db.product.findFirst.mockResolvedValueOnce({
      ...(await db.product.findFirst()),
      fulfillmentType: "course",
      commerceDomain: "course",
      courseContentOwnerMembershipId: "membership-f",
      coursePromoterShareBps: 2_500,
      coursePolicyVersion: 6,
      deliveryConfig: { id: "delivery-config-1", status: "active", fulfillmentType: "course" },
    });
    const response = await POST(checkoutRequest(undefined, { shipping: null }));
    expect(response.status).toBe(200);
    expect(db.paymentTransaction.create.mock.calls[0]?.[0]?.data?.metadata).toMatchObject({
      coursePolicySnapshot: { productId: "product-1", contentOwnerMembershipId: "membership-f", promoterShareBps: 2_500, policyVersion: 6 },
    });
  });

  it("replays the persisted checkout session without creating a second transaction or provider session", async () => {
    db.paymentTransaction.findUnique.mockResolvedValueOnce({
      id: "transaction-existing",
      vendorId: "vendor-1",
      providerName: "demo",
      checkoutIdempotencyKey: idempotencyKey,
      orderNumber: "CD-20260807120000-ABC123",
      grossAmountCents: 1200,
      currency: "TWD",
      status: "pending",
      primaryCommerceOrder: { checkoutIdentityHash: identityHash() },
      metadata: {
        productId: "product-1",
        checkoutSession: {
          provider: "demo",
          mode: "manual",
          formPayload: { orderNumber: "CD-20260807120000-ABC123", transactionId: "transaction-existing" },
          nextAction: "demo_checkout_transaction_created",
          externalRequired: false,
        },
      },
    });

    const response = await POST(checkoutRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      transactionId: "transaction-existing",
      orderNumber: "CD-20260807120000-ABC123",
      formPayload: { transactionId: "transaction-existing" },
    });
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns a bounded finished response when a paid checkout is retried", async () => {
    db.paymentTransaction.findUnique.mockResolvedValueOnce({
      id: "transaction-paid",
      vendorId: "vendor-1",
      providerName: "demo",
      checkoutIdempotencyKey: idempotencyKey,
      orderNumber: "CD-20260807120000-PAID01",
      grossAmountCents: 1200,
      currency: "TWD",
      status: "paid",
      primaryCommerceOrder: { checkoutIdentityHash: identityHash() },
      metadata: { productId: "product-1" },
    });

    const response = await POST(checkoutRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Checkout request already finished" });
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("replays an existing checkout without resolving the current provider", async () => {
    db.paymentTransaction.findUnique.mockResolvedValueOnce({
      id: "transaction-existing",
      vendorId: "vendor-1",
      providerName: "demo",
      checkoutIdempotencyKey: idempotencyKey,
      orderNumber: "CD-20260807120000-ABC123",
      grossAmountCents: 1200,
      currency: "TWD",
      status: "pending",
      primaryCommerceOrder: { checkoutIdentityHash: identityHash() },
      metadata: {
        productId: "product-1",
        checkoutSession: {
          provider: "demo",
          mode: "manual",
          formPayload: { orderNumber: "CD-20260807120000-ABC123", transactionId: "transaction-existing" },
          nextAction: "demo_checkout_transaction_created",
          externalRequired: false,
        },
      },
    });
    const response = await POST(checkoutRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ transactionId: "transaction-existing" });
    expect(paymentProviderMocks.getPaymentProvider).not.toHaveBeenCalled();
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("fails closed when an idempotency key is bound to another product", async () => {
    db.paymentTransaction.findUnique.mockResolvedValueOnce({
      id: "transaction-existing",
      vendorId: "vendor-1",
      providerName: "demo",
      checkoutIdempotencyKey: idempotencyKey,
      orderNumber: "CD-20260807120000-ABC123",
      grossAmountCents: 1200,
      currency: "TWD",
      status: "pending",
      primaryCommerceOrder: { checkoutIdentityHash: identityHash() },
      metadata: { productId: "another-product" },
    });

    const response = await POST(checkoutRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Idempotency key already used for another checkout" });
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
  });

  it("rejects an idempotency replay when buyer or shipping identity changes", async () => {
    db.paymentTransaction.findUnique.mockResolvedValueOnce({
      id: "transaction-existing",
      vendorId: "vendor-1",
      providerName: "demo",
      checkoutIdempotencyKey: idempotencyKey,
      orderNumber: "CD-20260807120000-ABC123",
      grossAmountCents: 1200,
      currency: "TWD",
      status: "pending",
      primaryCommerceOrder: { checkoutIdentityHash: identityHash() },
      metadata: { productId: "product-1" },
    });

    const response = await POST(checkoutRequest(undefined, {
      buyer: { ...buyer, email: "different@example.test" },
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Idempotency key already used for another checkout" });
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
  });

  it("rejects a direct idempotency replay when custom answers change", async () => {
    const customCheckoutFields = [{ key: "engraving", label: "刻字內容", type: "text", required: true }];
    db.product.findFirst.mockResolvedValueOnce({
      ...(await db.product.findFirst()),
      customCheckoutFields,
    });
    db.paymentTransaction.findUnique.mockResolvedValueOnce({
      id: "transaction-existing",
      vendorId: "vendor-1",
      providerName: "demo",
      checkoutIdempotencyKey: idempotencyKey,
      orderNumber: "CD-20260807120000-ABC123",
      grossAmountCents: 1200,
      currency: "TWD",
      status: "pending",
      primaryCommerceOrder: {
        checkoutIdentityHash: identityHash({ buyer, shipping }, customCheckoutFields, { engraving: "原本內容" }),
      },
      metadata: { productId: "product-1" },
    });

    const response = await POST(checkoutRequest(undefined, { customCheckoutAnswers: { engraving: "改過內容" } }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Idempotency key already used for another checkout" });
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
  });

  it("rejects a concurrent winner when custom answers differ", async () => {
    const customCheckoutFields = [{ key: "engraving", label: "刻字內容", type: "text", required: true }];
    db.product.findFirst.mockResolvedValueOnce({
      ...(await db.product.findFirst()),
      customCheckoutFields,
    });
    inventoryMocks.createReservedPaymentTransaction.mockRejectedValueOnce(
      new inventoryMocks.CheckoutIdempotencyConflictError("transaction-winner"),
    );
    db.paymentTransaction.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "transaction-winner",
        vendorId: "vendor-1",
        providerName: "demo",
        checkoutIdempotencyKey: idempotencyKey,
        orderNumber: "CD-20260807120000-WINNER",
        grossAmountCents: 1200,
        currency: "TWD",
        status: "pending",
        primaryCommerceOrder: {
          checkoutIdentityHash: identityHash({ buyer, shipping }, customCheckoutFields, { engraving: "原本內容" }),
        },
        metadata: { productId: "product-1" },
      });

    const response = await POST(checkoutRequest(undefined, { customCheckoutAnswers: { engraving: "改過內容" } }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Idempotency key already used for another checkout" });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns a bounded in-progress response when a concurrent winner has not persisted provider metadata yet", async () => {
    db.paymentTransaction.findUnique.mockResolvedValueOnce({
      id: "transaction-existing",
      vendorId: "vendor-1",
      providerName: "demo",
      checkoutIdempotencyKey: idempotencyKey,
      orderNumber: "CD-20260807120000-ABC123",
      grossAmountCents: 1200,
      currency: "TWD",
      status: "pending",
      primaryCommerceOrder: { checkoutIdentityHash: identityHash() },
      metadata: { productId: "product-1" },
    });

    const response = await POST(checkoutRequest());

    expect(response.status).toBe(425);
    await expect(response.json()).resolves.toEqual({ error: "Checkout already in progress" });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("keeps the same checkout identity while the concurrent canonical order is not visible yet", async () => {
    db.paymentTransaction.findUnique.mockResolvedValueOnce({
      id: "transaction-existing",
      vendorId: "vendor-1",
      providerName: "demo",
      checkoutIdempotencyKey: idempotencyKey,
      orderNumber: "CD-20260807120000-ABC123",
      grossAmountCents: 1200,
      currency: "TWD",
      status: "pending",
      primaryCommerceOrder: null,
      metadata: {
        productId: "product-1",
        checkoutSession: {
          provider: "demo",
          mode: "manual",
          nextAction: "demo_checkout_transaction_created",
          externalRequired: false,
        },
      },
    });

    const response = await POST(checkoutRequest());

    expect(response.status).toBe(425);
    await expect(response.json()).resolves.toEqual({ error: "Checkout already in progress" });
    expect(inventoryMocks.createReservedPaymentTransaction).not.toHaveBeenCalled();
    expect(createCheckoutSession).not.toHaveBeenCalled();
    expect(buyerSupportMocks.issueBuyerSupportGrant).not.toHaveBeenCalled();
  });

  it("replays the same checkout after buyer support access briefly fails", async () => {
    db.paymentTransaction.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "transaction-1",
        vendorId: "vendor-1",
        providerName: "demo",
        checkoutIdempotencyKey: idempotencyKey,
        orderNumber: "CD-20260807120000-ABC123",
        grossAmountCents: 1200,
        currency: "TWD",
        status: "pending",
        primaryCommerceOrder: { id: "order-1", checkoutIdentityHash: identityHash() },
        metadata: {
          productId: "product-1",
          checkoutSession: {
            provider: "demo",
            mode: "manual",
            nextAction: "demo_checkout_transaction_created",
            externalRequired: false,
          },
        },
      });
    buyerSupportMocks.issueBuyerSupportGrant.mockRejectedValueOnce(new Error("synthetic support grant outage"));

    const first = await POST(checkoutRequest());
    expect(first.status).toBe(503);
    await expect(first.json()).resolves.toEqual({ error: "Checkout support access unavailable" });

    const retry = await POST(checkoutRequest());
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({ transactionId: "transaction-1" });
    expect(inventoryMocks.createReservedPaymentTransaction).toHaveBeenCalledTimes(1);
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(buyerSupportMocks.issueBuyerSupportGrant).toHaveBeenCalledTimes(2);
  });
});

describe("checkout affiliate click attribution", () => {
  const visitorId = "visitor-123456789012345";

  it("stores a server-verified, current same-visitor affiliate click and its resolved referral code", async () => {
    db.affiliateClick.findFirst.mockResolvedValue({
      id: "click-1",
      affiliateId: "affiliate-1",
      referralCode: "VALIDCODE",
      affiliate: { code: "VALIDCODE", vendorId: "vendor-1", isActive: true },
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

  it("stores a server-owned team click for conversion attribution without inventing affiliate commission", async () => {
    db.affiliateClick.findFirst.mockResolvedValue({
      id: "click-team-1",
      affiliateId: null,
      referralCode: null,
      affiliate: null,
      live: { quotaPolicy: { affiliateMode: "disabled" } },
      teamAttribution: { id: "team-click-1" },
    });

    const response = await POST(checkoutRequest(
      `${attributionCookie({ clickId: "click-team-1", visitorId, issuedAt: Date.now() })}; celebratedeal_visitor=${visitorId}`,
      { vendorId: "vendor-1", productId: "product-1" },
    ));

    expect(response.status).toBe(200);
    expect(db.affiliateClick.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "click-team-1",
        vendorId: "vendor-1",
        visitorId,
        OR: [
          { affiliate: { is: { vendorId: "vendor-1", isActive: true } } },
          { teamAttribution: { is: { vendorId: "vendor-1" } } },
        ],
      }),
      select: expect.objectContaining({ teamAttribution: { select: { id: true } } }),
    }));
    expect(db.paymentTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: expect.objectContaining({ affiliateClickId: "click-team-1" }),
      }),
    }));
    const metadata = db.paymentTransaction.create.mock.calls[0]?.[0].data.metadata;
    expect(metadata).not.toHaveProperty("referralCode");
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ referralCode: undefined }));
  });

  it("fails closed when a live policy disables legacy affiliate attribution", async () => {
    db.affiliateClick.findFirst.mockResolvedValue({
      id: "click-1",
      affiliateId: "affiliate-1",
      referralCode: "VALIDCODE",
      affiliate: { code: "VALIDCODE", vendorId: "vendor-1", isActive: true },
      live: { quotaPolicy: { affiliateMode: "disabled" } },
    });

    const response = await POST(checkoutRequest(
      `${attributionCookie({ clickId: "click-1", visitorId, issuedAt: Date.now() })}; celebratedeal_visitor=${visitorId}`,
      { vendorId: "vendor-1", productId: "product-1" },
    ));

    expect(response.status).toBe(200);
    expectNoAffiliateAttribution();
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

  it("ignores an unsigned legacy attribution cookie and still completes checkout", async () => {
    const legacyValue = Buffer.from(JSON.stringify({ clickId: "click-1", visitorId, issuedAt: Date.now() })).toString("base64url");
    const response = await POST(checkoutRequest(
      `celebratedeal_attribution=${legacyValue}; celebratedeal_visitor=${visitorId}`,
      { vendorId: "vendor-1", productId: "product-1" },
    ));

    expect(response.status).toBe(200);
    expect(db.affiliateClick.findFirst).not.toHaveBeenCalled();
    expectNoAffiliateAttribution();
  });
});

describe("checkout form submission attribution", () => {
  it("carries a verified same-vendor live registration into transaction metadata", async () => {
    const response = await POST(checkoutRequest("celebratedeal_form_submission=submission-1"));

    expect(response.status).toBe(200);
    expect(db.formSubmission.findFirst).toHaveBeenCalledWith({
      where: {
        id: "submission-1",
        verificationStatus: "VERIFIED",
        form: { vendorId: "vendor-1" },
        live: { is: { vendorId: "vendor-1" } },
      },
      select: { id: true, liveId: true },
    });
    expect(db.paymentTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.objectContaining({ formSubmissionId: "submission-1", sourceLiveId: "live-1" }) }),
    }));
    expect(db.paymentTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.objectContaining({ formSubmissionId: "submission-1", sourceLiveId: "live-1" }) }),
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
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.getSetCookie()[0]).toContain("celebrate_support_");
  });

  it("checks out normally when the attribution cookie is missing", async () => {
    const response = await POST(checkoutRequest());

    expect(response.status).toBe(200);
    expect(db.formSubmission.findFirst).not.toHaveBeenCalled();
    expect(db.paymentTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.not.objectContaining({ formSubmissionId: expect.anything() }) }),
    }));
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.getSetCookie()[0]).toContain("celebrate_support_");
  });

  it("ignores a malformed attribution cookie without blocking checkout", async () => {
    const response = await POST(checkoutRequest("celebratedeal_form_submission=not/a-submission-id"));

    expect(response.status).toBe(200);
    expect(db.formSubmission.findFirst).not.toHaveBeenCalled();
    expect(db.paymentTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.not.objectContaining({ formSubmissionId: expect.anything() }) }),
    }));
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.getSetCookie()[0]).toContain("celebrate_support_");
  });
});

describe("checkout provider failures", () => {
  it("returns sold out when inventory is consumed between product lookup and reservation", async () => {
    inventoryMocks.createReservedPaymentTransaction.mockRejectedValueOnce(
      new inventoryMocks.InventoryUnavailableError(),
    );

    const response = await POST(checkoutRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Product is sold out" });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("fails the transaction without trusting the request Host when the production app URL is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    checkoutReadiness.mockReturnValueOnce("ready");

    const response = await POST(checkoutRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Unable to start checkout" });
    expect(createCheckoutSession).not.toHaveBeenCalled();
    expect(db.paymentTransaction.update).toHaveBeenCalledWith({
      where: { id: "transaction-1" },
      data: { status: "failed" },
    });
  });

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
