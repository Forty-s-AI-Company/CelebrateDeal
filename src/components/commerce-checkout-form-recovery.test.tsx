// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommerceCheckoutForm } from "@/components/commerce-checkout-form";
import {
  checkoutIdempotencyStorageKey,
  readCheckoutIdempotencyKey,
  saveCheckoutRecoveryRecord,
} from "@/lib/checkout-idempotency";

const key = "123e4567-e89b-42d3-a456-426614174000";
const admissionToken = `ca1.${"a".repeat(64)}.${"b".repeat(43)}`;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/checkout/vendor-1/product-1?resume=1");
  window.sessionStorage.setItem(checkoutIdempotencyStorageKey("vendor-1", "product-1"), key);
  saveCheckoutRecoveryRecord(window.sessionStorage, window.location.pathname, {
    vendorId: "vendor-1", productId: "product-1", idempotencyKey: key,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

describe("pending checkout recovery", () => {
  it("keeps the original key after a mistyped identity and retries the same order", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ admissionToken, idempotencyKey: key, expiresAt: "2027-01-01T00:00:00.000Z" }) })
      .mockResolvedValueOnce({ ok: false, status: 409 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ admissionToken, idempotencyKey: key, expiresAt: "2027-01-01T00:00:00.000Z" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({
        ok: true, provider: "demo", orderNumber: "CD-1", transactionId: "transaction-1",
        amountCents: 1200, currency: "TWD", checkoutUrl: null,
        nextAction: "demo_checkout_transaction_created", externalRequired: false,
      }) });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(<CommerceCheckoutForm
        vendorId="vendor-1" productId="product-1" productName="原商品" fulfillmentType="digital" recoveryOnly
      />);
    });
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    const name = form?.querySelector<HTMLInputElement>('[name="buyerName"]');
    const email = form?.querySelector<HTMLInputElement>('[name="buyerEmail"]');
    expect(name).not.toBeNull();
    expect(email).not.toBeNull();
    name!.value = "王小明";
    email!.value = "wrong@example.test";

    await act(async () => { form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(readCheckoutIdempotencyKey(window.sessionStorage, "vendor-1", "product-1")).toBe(key);
    expect(container.textContent).toContain("重新");

    email!.value = "buyer@example.test";
    await act(async () => { form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const checkoutBodies = fetchMock.mock.calls
      .filter(([url]) => url === "/api/payments/checkout")
      .map(([, init]) => JSON.parse(init.body as string) as { idempotencyKey: string });
    expect(checkoutBodies).toHaveLength(2);
    expect(checkoutBodies.map((body) => body.idempotencyKey)).toEqual([key, key]);
  });
});
