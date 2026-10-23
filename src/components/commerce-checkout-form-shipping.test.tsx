// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommerceCheckoutForm } from "@/components/commerce-checkout-form";

const key = "123e4567-e89b-42d3-a456-426614174000";
const admissionToken = `ca1.${"a".repeat(64)}.${"b".repeat(43)}`;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.sessionStorage.clear();
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

const field = (name: string) => container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
const sameAsBuyer = () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
  .find((input) => input.closest("label")?.textContent?.includes("收件資料同購買人"));

async function type(name: string, value: string) {
  const input = field(name);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function renderPhysical() {
  await act(async () => { root.render(<CommerceCheckoutForm vendorId="vendor-1" productId="product-1" productName="實體商品" fulfillmentType="physical" />); });
}

describe("shipping same-as-buyer", () => {
  it("is checked by default, labelled, and prefills recipient name and phone from the buyer", async () => {
    await renderPhysical();
    const checkbox = sameAsBuyer()!;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.hasAttribute("name")).toBe(false);
    expect(checkbox.closest("label")!.className).toContain("min-h-11");
    await type("buyerName", "合成買家");
    await type("buyerPhone", "0912345678");
    expect(field("recipientName").value).toBe("合成買家");
    expect(field("shippingPhone").value).toBe("0912345678");
    expect(field("recipientName").readOnly).toBe(false);
    expect(field("recipientName").disabled).toBe(false);
    expect(container.querySelector('[name="shippingEmail"], [name="recipientEmail"]')).toBeNull();
  });

  it("keeps syncing while checked and stops after a manual recipient edit", async () => {
    await renderPhysical();
    await type("buyerName", "合成");
    await type("buyerName", "合成買家");
    expect(field("recipientName").value).toBe("合成買家");
    await type("shippingPhone", "0987654321");
    expect(sameAsBuyer()!.checked).toBe(false);
    expect(field("recipientName").value).toBe("合成買家");
    expect(field("shippingPhone").value).toBe("0987654321");
    await type("buyerName", "改名買家");
    await type("buyerPhone", "0911111111");
    expect(field("recipientName").value).toBe("合成買家");
    expect(field("shippingPhone").value).toBe("0987654321");
  });

  it("keeps the current values when unchecked and resyncs when checked again", async () => {
    await renderPhysical();
    await type("buyerName", "合成買家");
    await type("buyerPhone", "0912345678");
    await act(async () => { sameAsBuyer()!.click(); });
    expect(sameAsBuyer()!.checked).toBe(false);
    expect(field("recipientName").value).toBe("合成買家");
    expect(field("shippingPhone").value).toBe("0912345678");
    await type("buyerName", "另一位買家");
    expect(field("recipientName").value).toBe("合成買家");
    await type("recipientName", "合成收件人");
    expect(field("recipientName").value).toBe("合成收件人");
    await act(async () => { sameAsBuyer()!.click(); });
    expect(sameAsBuyer()!.checked).toBe(true);
    expect(field("recipientName").value).toBe("另一位買家");
  });

  it("submits the prefilled recipient through the unchanged shipping payload", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ admissionToken, idempotencyKey: key, expiresAt: "2027-01-01T00:00:00.000Z" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        ok: true, provider: "demo", orderNumber: "CD-1", transactionId: "transaction-1", amountCents: 1200, currency: "TWD",
        checkoutUrl: null, nextAction: "demo_checkout_transaction_created", externalRequired: false,
      }) });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", { randomUUID: () => key });
    await renderPhysical();
    await type("buyerName", "合成買家");
    await type("buyerEmail", "buyer@example.test");
    await type("buyerPhone", "0912345678");
    await type("administrativeArea", "台北市");
    await type("locality", "中正區");
    await type("addressLine1", "合成測試路 1 號");
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String(fetchMock.mock.calls[1]![1].body));
    expect(body.shipping).toEqual({
      recipientName: "合成買家", phone: "0912345678", countryCode: "TW", postalCode: "",
      administrativeArea: "台北市", locality: "中正區", addressLine1: "合成測試路 1 號",
    });
    expect(body.buyer).toEqual({ name: "合成買家", email: "buyer@example.test", phone: "0912345678" });
    expect(body).not.toHaveProperty("sameAsBuyer");
  });

  it.each(["digital", "service", "course"] as const)("does not render the same-as-buyer option for %s products", async (fulfillmentType) => {
    await act(async () => { root.render(<CommerceCheckoutForm vendorId="vendor-1" productId="product-1" productName="非實體商品" fulfillmentType={fulfillmentType} />); });
    expect(container.textContent).not.toContain("收件資料同購買人");
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  });
});
