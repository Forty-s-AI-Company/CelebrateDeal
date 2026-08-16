import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/checkout/[vendorId]/[productId]/page", () => ({
  default: () => <div data-testid="canonical-checkout">Canonical checkout</div>,
}));

vi.mock("@/components/checkout-overlay", () => ({
  CheckoutOverlay: ({ children }: { children: React.ReactNode }) => <aside data-testid="checkout-overlay">{children}</aside>,
}));

import InterceptedLiveCheckoutPage from "./page";

describe("live-scoped intercepted checkout", () => {
  it("reuses the canonical checkout inside the live-only overlay slot", async () => {
    const html = renderToStaticMarkup(await InterceptedLiveCheckoutPage({
      params: Promise.resolve({ vendorId: "vendor-1", productId: "product-1" }),
      searchParams: Promise.resolve({}),
    }));

    expect(html).toContain('data-testid="checkout-overlay"');
    expect(html).toContain('data-testid="canonical-checkout"');
  });
});
