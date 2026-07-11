import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { POST as checkout } from "@/app/api/payments/checkout/route";
import { POST as paymentWebhook } from "@/app/api/webhooks/payments/route";
import { getDb } from "@/lib/db";

const vendorIds: string[] = [];
const planIds: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  await getDb().billingPlan.deleteMany({ where: { id: { in: planIds.splice(0) } } });
  await getDb().auditLog.deleteMany({
    where: { action: { in: ["payment_webhook_provider_rejected", "payment_webhook_signature_failed", "payment_webhook_provider_mismatch", "payment_webhook_invalid"] } },
  });
});

function webhookRequest(provider?: string, headers: Record<string, string> = {}) {
  const query = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  return new Request(`https://app.example.test/api/webhooks/payments${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      eventId: "evt-route-security",
      eventType: "paid",
      orderNumber: "ORDER-ROUTE-SECURITY",
      grossAmountCents: 100,
    }),
  });
}

describe("payment route fail-closed behavior", () => {
  it.each([undefined, "unknown-provider"])("rejects missing or unknown provider %s without financial writes", async (provider) => {
    const response = await paymentWebhook(webhookRequest(provider));
    expect(response.status).toBe(400);
    await expect(getDb().paymentTransaction.count({ where: { orderNumber: "ORDER-ROUTE-SECURITY" } })).resolves.toBe(0);
  });

  it("rejects demo webhook in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await paymentWebhook(webhookRequest("demo"));
    expect(response.status).toBe(400);
    await expect(getDb().paymentTransaction.count({ where: { orderNumber: "ORDER-ROUTE-SECURITY" } })).resolves.toBe(0);
  });

  it("rejects an invalid signed-provider request", async () => {
    vi.stubEnv("ECPAY_WEBHOOK_SECRET", "route-test-secret");
    const response = await paymentWebhook(webhookRequest("ecpay-like", { "x-ecpay-signature": "invalid" }));
    expect(response.status).toBe(401);
    await expect(getDb().paymentTransaction.count({ where: { orderNumber: "ORDER-ROUTE-SECURITY" } })).resolves.toBe(0);
  });

  it("rejects a correctly signed PayUni callback with missing status and amount before ledger writes", async () => {
    const secret = "payuni-route-webhook-secret";
    vi.stubEnv("PAYUNI_WEBHOOK_SECRET", secret);
    const body = JSON.stringify({ EventId: "evt-payuni-malformed", MerTradeNo: "ORDER-PAYUNI-MALFORMED" });
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const response = await paymentWebhook(new Request("https://app.example.test/api/webhooks/payments?provider=payuni", {
      method: "POST",
      headers: { "content-type": "application/json", "x-payuni-signature": signature },
      body,
    }));

    expect(response.status).toBe(400);
    await expect(getDb().webhookEvent.count({ where: { provider: "payuni", eventId: "evt-payuni-malformed" } })).resolves.toBe(0);
    await expect(getDb().paymentTransaction.count({ where: { orderNumber: "ORDER-PAYUNI-MALFORMED" } })).resolves.toBe(0);
  });

  it("returns 503 before creating checkout transaction when production is configured with demo", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENT_PROVIDER", "demo");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const vendor = await getDb().vendor.create({
      data: { name: "Checkout Security", slug: `checkout-security-${suffix}`, email: `checkout-${suffix}@example.test`, passwordHash: "test" },
    });
    vendorIds.push(vendor.id);
    const product = await getDb().product.create({
      data: { vendorId: vendor.id, name: "Secure Product", slug: `secure-product-${suffix}`, priceCents: 1000, inventory: 1 },
    });
    const before = await getDb().paymentTransaction.count({ where: { vendorId: vendor.id } });

    const response = await checkout(new Request("https://app.example.test/api/payments/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.example.test",
        "x-celebratedeal-client": "web",
      },
      body: JSON.stringify({ vendorId: vendor.id, productId: product.id }),
    }));

    expect(response.status).toBe(503);
    await expect(getDb().paymentTransaction.count({ where: { vendorId: vendor.id } })).resolves.toBe(before);
  });

  it("claims a concurrent duplicate webhook only once", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const plan = await getDb().billingPlan.create({
      data: { name: `Webhook Claim ${suffix}`, code: `webhook-claim-${suffix}`, transactionFeeRateBps: 100 },
    });
    planIds.push(plan.id);
    const vendor = await getDb().vendor.create({
      data: {
        name: "Webhook Claim",
        slug: `webhook-claim-${suffix}`,
        email: `claim-${suffix}@example.test`,
        passwordHash: "test",
        subscriptions: { create: { planId: plan.id, paymentMode: "platform", status: "active" } },
      },
    });
    vendorIds.push(vendor.id);
    const orderNumber = `ORDER-CLAIM-${suffix}`;
    await getDb().paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber,
        grossAmountCents: 1000,
        netAmountCents: 1000,
        status: "pending",
      },
    });
    const body = JSON.stringify({
      eventId: `evt-claim-${suffix}`,
      eventType: "paid",
      orderNumber,
      grossAmountCents: 1000,
    });
    const request = () => new Request("https://app.example.test/api/webhooks/payments?provider=demo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    const responses = await Promise.all([paymentWebhook(request()), paymentWebhook(request())]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 202]);
    await expect(getDb().webhookEvent.count({ where: { provider: "demo", eventId: `evt-claim-${suffix}` } })).resolves.toBe(1);
    const transaction = await getDb().paymentTransaction.findUniqueOrThrow({
      where: { providerName_orderNumber: { providerName: "demo", orderNumber } },
    });
    expect(transaction.status).toBe("paid");
  });
});
