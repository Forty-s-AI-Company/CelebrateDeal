import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeterministicMetaCapiAdapter,
  buildGoogleEnhancedConversionPayload,
  buildMetaCapiPayload,
  dispatchPaidCommerceOrderTracking,
  dispatchServerSideTracking,
  dispatchStoredServerSideTracking,
  hashTrackingEmail,
  hashTrackingPhone,
  type MetaCapiAdapter,
  type ServerSideTrackingEvent,
} from "@/lib/server-side-tracking";
import { protectFacebookAccessToken, unprotectFacebookAccessToken } from "@/lib/tracking-credentials";
import { protectCommerceOrderPii } from "@/lib/commerce-order-pii";

const event: ServerSideTrackingEvent = {
  vendorId: "vendor-a",
  eventName: "Purchase",
  eventId: "order-123:paid",
  occurredAt: new Date("2026-09-09T02:03:04.000Z"),
  eventSourceUrl: "https://academy.example.test/checkout/result?order=123#complete",
  customer: {
    email: " Learner@Example.Test ",
    phone: "+886 912-345-678",
    externalId: "buyer-opaque-id",
    clientIpAddress: "203.0.113.8",
    clientUserAgent: "CelebrateDeal test browser",
  },
  valueCents: 128_800,
  currency: "twd",
  contentIds: ["course-1"],
};

describe("server-side tracking", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("builds a Meta CAPI payload with normalized SHA-256 identifiers and no raw PII", () => {
    const payload = buildMetaCapiPayload(event, { testEventCode: "TEST123" });
    const data = payload.data[0]!;

    expect(data).toMatchObject({
      event_name: "Purchase",
      event_time: 1_788_919_384,
      event_id: "order-123:paid",
      action_source: "website",
      event_source_url: "https://academy.example.test/checkout/result?order=123",
      user_data: {
        em: [hashTrackingEmail("learner@example.test")],
        ph: [hashTrackingPhone("886912345678")],
      },
      custom_data: { currency: "TWD", value: 1288, content_ids: ["course-1"] },
    });
    expect(payload.test_event_code).toBe("TEST123");
    expect(JSON.stringify(payload)).not.toContain("Learner@Example.Test");
    expect(JSON.stringify(payload)).not.toContain("912-345");
    expect(JSON.stringify(payload)).not.toContain("buyer-opaque-id");
  });

  it("creates a matching Google Enhanced Conversions envelope", () => {
    expect(buildGoogleEnhancedConversionPayload(event)).toMatchObject({
      eventName: "Purchase",
      userData: {
        sha256EmailAddress: hashTrackingEmail("learner@example.test"),
        sha256PhoneNumber: hashTrackingPhone("886912345678"),
      },
      value: 1288,
      currency: "TWD",
    });
  });

  it("uses a deterministic mock adapter and never retains the access token", async () => {
    const adapter = new DeterministicMetaCapiAdapter();
    const result = await dispatchServerSideTracking(event, {
      facebookPixelId: "pixel-1",
      facebookAccessToken: "not-a-real-token",
      testEventCode: "TEST123",
    }, adapter);

    expect(result).toEqual({ status: "delivered", provider: "meta", eventId: "order-123:paid" });
    expect(adapter.delivered).toHaveLength(1);
    expect(JSON.stringify(adapter.delivered)).not.toContain("not-a-real-token");
  });

  it("fails closed for invalid payloads, missing setup and adapter errors", async () => {
    const adapter: MetaCapiAdapter = { dispatch: vi.fn().mockRejectedValue(new Error("provider failure")) };
    await expect(dispatchServerSideTracking(event, {}, adapter)).resolves.toEqual({ status: "skipped", reason: "not_configured" });
    await expect(dispatchServerSideTracking({ ...event, eventSourceUrl: "javascript:alert(1)" }, {
      facebookPixelId: "pixel-1",
      facebookAccessToken: "not-a-real-token",
    }, adapter)).resolves.toEqual({ status: "failed", reason: "invalid_input" });
    await expect(dispatchServerSideTracking(event, {
      facebookPixelId: "pixel-1",
      facebookAccessToken: "not-a-real-token",
    }, adapter)).resolves.toEqual({ status: "failed", reason: "provider_rejected" });
    expect(adapter.dispatch).toHaveBeenCalledTimes(1);
  });

  it("honors merchant event switches before building or sending payloads", async () => {
    const adapter = new DeterministicMetaCapiAdapter();
    await expect(dispatchServerSideTracking({ ...event, eventName: "Lead" }, {
      facebookPixelId: "pixel-1",
      facebookAccessToken: "not-a-real-token",
      enableLeadEvent: false,
    }, adapter)).resolves.toEqual({ status: "skipped", reason: "disabled" });
    expect(adapter.delivered).toHaveLength(0);
  });

  it("encrypts a saved Facebook token with a tenant-bound envelope", () => {
    vi.stubEnv("CSRF_SECRET", "tracking-test-encryption-secret-that-is-at-least-32-bytes");
    const token = "fake-meta-token-that-is-long-enough-to-be-validated";
    const encrypted = protectFacebookAccessToken("vendor-a", token);
    expect(encrypted).toMatch(/^v1\./u);
    expect(encrypted).not.toContain(token);
    expect(unprotectFacebookAccessToken("vendor-a", encrypted)).toBe(token);
    expect(() => unprotectFacebookAccessToken("vendor-b", encrypted)).toThrow();
  });

  it("dispatches Purchase only from a committed, tenant-bound commerce order", async () => {
    vi.stubEnv("CSRF_SECRET", "tracking-test-encryption-secret-that-is-at-least-32-bytes");
    const buyer = protectCommerceOrderPii({ buyer: { name: "學員", email: "learner@example.test", phone: "0912-345-678" }, shipping: null }, {
      vendorId: "vendor-a",
      orderId: "order-a",
    });
    const database = {
      commerceOrder: {
        findFirst: vi.fn().mockResolvedValue({
          id: "order-a", vendorId: "vendor-a", status: "paid", paidAt: event.occurredAt,
          paidAmountCents: 128_800, currency: "TWD", automationCustomerKeyHash: "customer-key-hash",
          buyerEncryptedEnvelope: buyer.buyerEncrypted, shippingEncryptedEnvelope: buyer.shippingEncrypted,
          items: [{ productId: "course-1" }],
        }),
      },
      trackingSetting: {
        findUnique: vi.fn().mockResolvedValue({
          facebookPixelId: "pixel-1",
          facebookAccessTokenEncrypted: protectFacebookAccessToken("vendor-a", "fake-meta-token-that-is-long-enough-to-be-validated"),
          facebookTestEventCode: "TEST123",
          enableLeadEvent: true,
          enablePurchaseEvent: true,
        }),
      },
    };
    const adapter = new DeterministicMetaCapiAdapter();

    await expect(dispatchPaidCommerceOrderTracking(database, {
      vendorId: "vendor-a",
      paymentTransactionId: "transaction-a",
      eventSourceUrl: "https://academy.example.test/checkout/result",
      occurredAt: event.occurredAt,
    }, adapter)).resolves.toEqual({ status: "delivered", provider: "meta", eventId: "purchase:transaction-a" });
    expect(database.commerceOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-a", primaryPaymentTransactionId: "transaction-a", status: "paid" },
    }));
    expect(adapter.delivered[0]?.payload.data[0]?.user_data.em).toEqual([hashTrackingEmail("learner@example.test")]);
  });

  it("offers a sanitized stored-settings facade for Lead, ViewContent and Schedule callers", async () => {
    vi.stubEnv("CSRF_SECRET", "tracking-test-encryption-secret-that-is-at-least-32-bytes");
    const adapter = new DeterministicMetaCapiAdapter();
    const storedSettings = {
      facebookPixelId: "pixel-1",
      facebookAccessTokenEncrypted: protectFacebookAccessToken("vendor-a", "fake-meta-token-that-is-long-enough-to-be-validated"),
      facebookTestEventCode: null,
      enableLeadEvent: true,
      enablePurchaseEvent: true,
    };
    for (const eventName of ["Lead", "ViewContent", "Schedule"] as const) {
      await expect(dispatchStoredServerSideTracking({ ...event, eventName, eventId: `${eventName}:event-a` }, storedSettings, adapter))
        .resolves.toMatchObject({ status: "delivered", eventId: `${eventName}:event-a` });
    }
    expect(adapter.delivered).toHaveLength(3);
  });
});
