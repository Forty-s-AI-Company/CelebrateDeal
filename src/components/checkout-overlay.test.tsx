import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const back = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ back }) }));

import { CheckoutOverlay } from "@/components/checkout-overlay";

describe("CheckoutOverlay", () => {
  it("exposes a non-modal checkout dialog so the persistent player remains operable", () => {
    const html = renderToStaticMarkup(<CheckoutOverlay><p>結帳內容</p></CheckoutOverlay>);
    expect(html).toContain('role="dialog"');
    expect(html).not.toContain("aria-modal");
    expect(html).toContain('aria-labelledby="checkout-overlay-title"');
    expect(html).toContain('aria-describedby="checkout-overlay-description"');
    expect(html).toContain("直播會繼續播放");
    expect(html).toContain("商品結帳");
    expect(html).toContain("返回直播");
    expect(html).toContain('aria-label="關閉結帳並返回直播"');
    expect(html).toContain("結帳內容");
  });
});
