import { afterEach, describe, expect, it, vi } from "vitest";
import { requestCheckout, submitCheckout } from "./live-playback";

describe("LivePlayback checkout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits every PayUni form-post field without redirecting to the product checkout URL", () => {
    const inputs: Array<{ type: string; name: string; value: string }> = [];
    const form = {
      method: "",
      action: "",
      style: { display: "" },
      appendChild: vi.fn((input: { type: string; name: string; value: string }) => inputs.push(input)),
      submit: vi.fn(),
    };
    const appendToBody = vi.fn();

    vi.stubGlobal("document", {
      createElement: vi.fn((tagName: string) => tagName === "form" ? form : { type: "", name: "", value: "" }),
      body: { appendChild: appendToBody },
    });
    vi.stubGlobal("window", { location: { href: "https://shop.example.test/product-checkout" } });

    const submitted = submitCheckout({
      formAction: "https://sandbox-api.payuni.com.tw/api/upp",
      formMethod: "POST",
      formPayload: {
        MerID: "merchant-123",
        Version: "1.0",
        EncryptInfo: "encrypted-payload",
        HashInfo: "signed-payload",
      },
      checkoutUrl: "https://checkout.example.test/should-not-redirect",
    });

    expect(submitted).toBe(true);
    expect(form.method).toBe("POST");
    expect(form.action).toBe("https://sandbox-api.payuni.com.tw/api/upp");
    expect(form.style.display).toBe("none");
    expect(inputs).toEqual([
      { type: "hidden", name: "MerID", value: "merchant-123" },
      { type: "hidden", name: "Version", value: "1.0" },
      { type: "hidden", name: "EncryptInfo", value: "encrypted-payload" },
      { type: "hidden", name: "HashInfo", value: "signed-payload" },
    ]);
    expect(appendToBody).toHaveBeenCalledWith(form);
    expect(form.submit).toHaveBeenCalledOnce();
    expect(window.location.href).toBe("https://shop.example.test/product-checkout");
  });

  it("does not navigate to the external product checkout URL when the checkout API fails", async () => {
    const productCheckoutUrl = "https://shop.example.test/external-product-checkout";
    vi.stubGlobal("window", { location: { href: "https://app.example.test/live/demo" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    await expect(requestCheckout({
      vendorId: "vendor-123",
      productId: "product-123",
      referralCode: null,
    })).resolves.toBe(false);

    expect(fetch).toHaveBeenCalledWith("/api/payments/checkout", expect.objectContaining({ method: "POST" }));
    expect(window.location.href).toBe("https://app.example.test/live/demo");
    expect(window.location.href).not.toBe(productCheckoutUrl);
  });

  it("does not navigate when a successful checkout API response has no provider action", async () => {
    const productCheckoutUrl = "https://shop.example.test/external-product-checkout";
    vi.stubGlobal("window", { location: { href: "https://app.example.test/live/demo" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    }));

    await expect(requestCheckout({
      vendorId: "vendor-123",
      productId: "product-123",
      referralCode: null,
    })).resolves.toBe(false);

    expect(window.location.href).toBe("https://app.example.test/live/demo");
    expect(window.location.href).not.toBe(productCheckoutUrl);
  });
});
