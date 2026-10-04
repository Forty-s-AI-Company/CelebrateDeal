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
  it("displays the signed offer and waits for a second confirmation before checkout", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ admissionToken, idempotencyKey: key, expiresAt: "2027-01-01T00:00:00.000Z", offer: { priceCents: 1000, currency: "TWD", hash: "a".repeat(64) } }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ code: "FLASH_SALE_UNAVAILABLE", error: "raw diagnostics" }) });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { root.render(<CommerceCheckoutForm vendorId="vendor-1" productId="product-1" productName="商品" fulfillmentType="digital" priceCents={2000} />); });
    const form = container.querySelector("form")!;
    form.querySelector<HTMLInputElement>('[name="buyerName"]')!.value = "測試買家";
    form.querySelector<HTMLInputElement>('[name="buyerEmail"]')!.value = "buyer@example.test";
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("確認優惠並前往付款");
    expect(container.querySelector("strong.text-xl")?.textContent).toContain("10");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/payments/checkout");
    expect(container.textContent).toContain("快閃優惠已變更");
    expect(container.textContent).not.toContain("raw diagnostics");
    expect(container.querySelector("strong.text-xl")?.textContent).toContain("20");
  });

  it("shows the voucher-specific failure and retains checkout identity for a normal checkout", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ admissionToken, idempotencyKey: key, expiresAt: "2027-01-01T00:00:00.000Z" }) })
      .mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: "LIVE_VOUCHER_ALREADY_USED", error: "untrusted raw diagnostic" }) });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { root.render(<CommerceCheckoutForm vendorId="vendor-1" productId="product-1" productName="商品" fulfillmentType="digital" />); });
    const form = container.querySelector("form")!;
    form.querySelector<HTMLInputElement>('[name="buyerName"]')!.value = "測試買家";
    form.querySelector<HTMLInputElement>('[name="buyerEmail"]')!.value = "buyer@example.test";
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(container.textContent).toContain("優惠券已綁定先前訂單");
    expect(container.textContent).not.toContain("商品可能已售完");
    expect(container.textContent).not.toContain("untrusted raw diagnostic");
    expect(readCheckoutIdempotencyKey(window.sessionStorage, "vendor-1", "product-1")).toBe(key);
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/payments/checkout/admission")).toHaveLength(1);
  });

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
