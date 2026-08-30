import { describe, expect, it } from "vitest";
import { demoPaymentProvider } from "@/lib/payment-providers/demo";

const transaction = { id: "tx-demo", orderNumber: "ORDER-DEMO" } as never;

describe("demo payment provider", () => {
  it("is explicitly limited to non-production checkout", () => {
    expect(demoPaymentProvider.checkoutReadiness()).toBe("local_only");
  });

  it("creates a local manual checkout session", async () => {
    await expect(demoPaymentProvider.createCheckoutSession!({
      transaction,
      product: {} as never,
      vendor: {} as never,
      appUrl: "http://127.0.0.1:3000",
    })).resolves.toEqual({
      provider: "demo",
      mode: "manual",
      checkoutUrl: null,
      nextAction: "demo_checkout_transaction_created",
      formPayload: { orderNumber: "ORDER-DEMO", transactionId: "tx-demo" },
    });
  });

  it("accepts the deterministic demo signature and normalizes webhook JSON", async () => {
    const rawBody = JSON.stringify({
      eventId: "demo-event-1",
      eventType: "paid",
      orderNumber: "ORDER-DEMO",
      grossAmountCents: 1200,
      metadata: { fixture: "synthetic" },
    });

    await expect(demoPaymentProvider.verifySignature(new Request("http://127.0.0.1"), rawBody)).resolves.toBe(true);
    const result = await demoPaymentProvider.normalizePayload(rawBody);

    expect(result.rawPayload).toEqual(expect.objectContaining({ eventId: "demo-event-1" }));
    expect(result.payload).toMatchObject({
      provider: "demo",
      eventId: "demo-event-1",
      eventType: "paid",
      orderNumber: "ORDER-DEMO",
      grossAmountCents: 1200,
      metadata: { fixture: "synthetic" },
    });
  });
});
