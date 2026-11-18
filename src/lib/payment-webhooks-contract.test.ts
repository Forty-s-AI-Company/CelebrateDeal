import { describe, expect, expectTypeOf, it } from "vitest";

import * as adapterContract from "@/lib/payment-providers/contract";
import * as paymentWebhooks from "@/lib/payment-webhooks";

describe("payment webhook payload contract (F-008)", () => {
  it("re-exports the adapter contract schema object from the webhook engine", () => {
    // One schema object, not a copy: adapters and the engine cannot drift apart.
    expect(paymentWebhooks.PaymentWebhookPayload).toBe(adapterContract.PaymentWebhookPayload);
  });

  it("exposes the same payload type from both paths", () => {
    expectTypeOf<paymentWebhooks.PaymentWebhookPayloadInput>().toEqualTypeOf<adapterContract.PaymentWebhookPayloadInput>();
  });
});
