import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeShippingFulfillment: vi.fn(),
}));

vi.mock("@/lib/commerce-shipping-action", () => ({
  completeShippingFulfillment: mocks.completeShippingFulfillment,
}));

import { POST } from "./route";

describe("shipping fulfillment route", () => {
  beforeEach(() => {
    mocks.completeShippingFulfillment.mockReset();
  });

  it("keeps the validated browser origin on the native fulfillment redirect", async () => {
    mocks.completeShippingFulfillment.mockResolvedValue("/orders/order-1?updated=shipping");
    const formData = new FormData();
    formData.set("orderId", "order-1");

    const response = await POST(new Request("http://127.0.0.1:31023/api/orders/shipping", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:31023" },
      body: formData,
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:31023/orders/order-1?updated=shipping");
    expect(mocks.completeShippingFulfillment).toHaveBeenCalledWith(formData);
  });

  it("falls back to the request origin when a browser omits Origin", async () => {
    mocks.completeShippingFulfillment.mockResolvedValue("/orders/order-1?error=fulfillment_conflict");

    const response = await POST(new Request("https://app.example.test/api/orders/shipping", {
      method: "POST",
      body: new FormData(),
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/orders/order-1?error=fulfillment_conflict");
  });
});
