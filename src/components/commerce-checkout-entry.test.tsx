// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkoutIdempotencyStorageKey,
  saveCheckoutRecoveryRecord,
} from "@/lib/checkout-idempotency";

vi.mock("@/components/commerce-checkout-form", () => ({
  CommerceCheckoutForm: ({ productName, customCheckoutFields, recoveryOnly }: {
    productName: string;
    customCheckoutFields: Array<{ label: string }>;
    recoveryOnly?: boolean;
  }) => <div data-recovery={String(Boolean(recoveryOnly))}>{productName}:{customCheckoutFields[0]?.label}</div>,
}));

import { CommerceCheckoutEntry } from "@/components/commerce-checkout-entry";

const key = "123e4567-e89b-42d3-a456-426614174000";
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/checkout/vendor-1/product-1?resume=1");
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

describe("CommerceCheckoutEntry", () => {
  it("loads the original fields for a pending recovery instead of the edited catalog fields", async () => {
    window.sessionStorage.setItem(checkoutIdempotencyStorageKey("vendor-1", "product-1"), key);
    saveCheckoutRecoveryRecord(window.sessionStorage, window.location.pathname, {
      vendorId: "vendor-1", productId: "product-1", idempotencyKey: key,
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        vendorId: "vendor-1", productId: "product-1", productName: "原商品",
        fulfillmentType: "physical", customCheckoutFields: [{ key: "engraving", label: "原刻字", type: "text", required: true }],
        priceCents: 1200, currency: "TWD", initialOrderBumpSelected: false,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<CommerceCheckoutEntry current={{
        vendorId: "vendor-1", productId: "product-1", productName: "新商品", fulfillmentType: "physical",
        priceCents: 2400, currency: "TWD",
        customCheckoutFields: [{ key: "message", label: "新欄位", type: "text", required: true }],
      }} summary={{ vendorName: "新商家", description: "新的商品敘述" }} />);
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/payments/checkout/recovery", expect.objectContaining({ method: "POST" }));
    expect(container.textContent).toContain("原商品:原刻字");
    expect(container.textContent).not.toContain("新商品:新欄位");
    expect(container.textContent).toContain("$12");
    expect(container.textContent).not.toContain("$24");
    expect(container.textContent).not.toContain("新的商品敘述");
    expect(container.querySelector('[data-recovery="true"]')).not.toBeNull();
  });

  it("never shows a new checkout form for a stopped product without a saved key", async () => {
    await act(async () => { root.render(<CommerceCheckoutEntry />); });
    expect(container.textContent).toContain("無法建立新訂單");
    expect(container.querySelector("[data-recovery]")).toBeNull();
  });
});
