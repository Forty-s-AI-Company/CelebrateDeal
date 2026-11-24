// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommerceCheckoutForm } from "@/components/commerce-checkout-form";
import { checkoutIdempotencyStorageKey, readCheckoutIdempotencyKey } from "@/lib/checkout-idempotency";

const key = "123e4567-e89b-42d3-a456-426614174000";
const admissionToken = `ca1.${"a".repeat(64)}.${"b".repeat(43)}`;
let container: HTMLDivElement;
let root: Root;

const preview = { ok: true, code: "Save200", discountAmountCents: 20_000, subtotalAmountCents: 100_000, totalAmountCents: 80_000, currency: "TWD" };
const checkoutResult = { ok: true, provider: "demo", orderNumber: "CD-1", transactionId: "transaction-1", amountCents: 80_000, currency: "TWD", checkoutUrl: null, nextAction: "demo_checkout_transaction_created", externalRequired: false };

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body, clone() { return this; } };
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.sessionStorage.setItem(checkoutIdempotencyStorageKey("vendor-1", "product-1"), key);
  window.history.replaceState({}, "", "/checkout/vendor-1/product-1");
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

async function render(props: Partial<Parameters<typeof CommerceCheckoutForm>[0]> = {}) {
  await act(async () => {
    root.render(<CommerceCheckoutForm vendorId="vendor-1" productId="product-1" productName="商品" fulfillmentType="digital" priceCents={100_000} discountCodeEntry={{}} {...props} />);
  });
  return container.querySelector("form")!;
}

function fillBuyer(form: HTMLFormElement) {
  form.querySelector<HTMLInputElement>('[name="buyerName"]')!.value = "測試買家";
  form.querySelector<HTMLInputElement>('[name="buyerEmail"]')!.value = "buyer@example.test";
}

async function typeCode(form: HTMLFormElement, value: string) {
  const input = form.querySelector<HTMLInputElement>('[name="discountCodeInput"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickButton(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === label)!;
  await act(async () => { button.click(); });
}

describe("checkout discount code (A4-01)", () => {
  it("is not shown unless the page offers it, nor next to a flash sale or upgrade", async () => {
    expect((await render({ discountCodeEntry: undefined })).querySelector('[name="discountCodeInput"]')).toBeNull();
    expect((await render({ flashSaleRunId: "sale-run" })).querySelector('[name="discountCodeInput"]')).toBeNull();
    expect((await render({ postPurchaseToken: `ppu1.x.${"c".repeat(43)}` })).querySelector('[name="discountCodeInput"]')).toBeNull();
  });

  it("previews the server discount, shows the new total and sends the code with the shown discount", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(preview))
      .mockResolvedValueOnce(json({ admissionToken, idempotencyKey: key, expiresAt: "2027-01-01T00:00:00.000Z" }))
      .mockResolvedValueOnce(json(checkoutResult));
    vi.stubGlobal("fetch", fetchMock);
    const form = await render();
    await typeCode(form, "save200");
    await clickButton("套用");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/payments/checkout/discount-code");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ vendorId: "vendor-1", productId: "product-1", discountCode: "save200" });
    expect(container.textContent).toContain("已套用 Save200");
    expect(container.textContent).toContain("NT$800");

    fillBuyer(form);
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const checkoutBody = JSON.parse(fetchMock.mock.calls[2]![1].body);
    expect(checkoutBody).toMatchObject({ discountCode: "Save200", expectedDiscountAmountCents: 20_000 });
    expect(checkoutBody).not.toHaveProperty("discountCodeInput");
  });

  it("does not submit a typed but unapplied code", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const form = await render();
    await typeCode(form, "SAVE200");
    fillBuyer(form);
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("請先按「套用」確認折扣碼");
  });

  it("shows the same generic message for an unknown or another vendor's code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "Discount code unavailable", code: "DISCOUNT_CODE_INVALID" }, 409)));
    const form = await render();
    await typeCode(form, "NOPE00");
    await clickButton("套用");
    expect(container.textContent).toContain("折扣碼無效或不適用於這個商品");
    expect(container.textContent).not.toContain("已套用");
  });

  it("drops the applied code when checkout refuses it and keeps the admission for a retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(preview))
      .mockResolvedValueOnce(json({ admissionToken, idempotencyKey: key, expiresAt: "2027-01-01T00:00:00.000Z" }))
      .mockResolvedValueOnce(json({ error: "Discount code unavailable", code: "DISCOUNT_CODE_USAGE_LIMIT" }, 409));
    vi.stubGlobal("fetch", fetchMock);
    const form = await render();
    await typeCode(form, "save200");
    await clickButton("套用");
    fillBuyer(form);
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(container.textContent).toContain("這個折扣碼已達使用上限");
    expect(container.textContent).not.toContain("已套用 Save200");
    // The order was rolled back; the same checkout identity is kept for the retry.
    expect(readCheckoutIdempotencyKey(window.sessionStorage, "vendor-1", "product-1")).toBe(key);
  });

  it("applies a merchant pre-filled code on load", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(preview));
    vi.stubGlobal("fetch", fetchMock);
    await render({ discountCodeEntry: { prefillCode: "SAVE200" } });
    await act(async () => { await Promise.resolve(); });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ discountCode: "SAVE200" });
    expect(container.textContent).toContain("已套用 Save200");
  });
});
