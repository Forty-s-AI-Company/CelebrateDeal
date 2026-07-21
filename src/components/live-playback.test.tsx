import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  cursor: 0,
  refCursor: 0,
  values: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();

  return {
    ...react,
    useEffect: () => undefined,
    useMemo: <Value,>(factory: () => Value) => factory(),
    useRef: <Value,>(initialValue: Value) => {
      const index = hookState.refCursor++;
      if (!hookState.refs[index]) hookState.refs[index] = { current: initialValue };
      return hookState.refs[index] as { current: Value };
    },
    useState: <Value,>(initialValue: Value | (() => Value)) => {
      const index = hookState.cursor++;
      if (hookState.values.length === index) {
        hookState.values.push(typeof initialValue === "function" ? (initialValue as () => Value)() : initialValue);
      }

      const setValue = (nextValue: Value | ((currentValue: Value) => Value)) => {
        const currentValue = hookState.values[index] as Value;
        hookState.values[index] = typeof nextValue === "function"
          ? (nextValue as (currentValue: Value) => Value)(currentValue)
          : nextValue;
      };

      return [hookState.values[index] as Value, setValue] as const;
    },
  };
});

vi.mock("@/lib/client-analytics", () => ({ trackClientAnalytics: vi.fn() }));
vi.mock("@/lib/visitor-id", () => ({ getOrCreateVisitorId: () => "test-fixture-visitor-id" }));

import { LivePlayback, openExternalUrl, requestCheckout, submitCheckout } from "./live-playback";

type ElementNode = {
  type: unknown;
  props: Record<string, unknown>;
};

function isElementNode(value: unknown): value is ElementNode {
  return typeof value === "object" && value !== null && "props" in value && "type" in value;
}

function findElements(value: unknown, predicate: (element: ElementNode) => boolean): ElementNode[] {
  if (Array.isArray(value)) return value.flatMap((child) => findElements(child, predicate));
  if (!isElementNode(value)) return [];

  return [
    ...(predicate(value) ? [value] : []),
    ...findElements(value.props.children, predicate),
  ];
}

function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join("");
  return isElementNode(value) ? textContent(value.props.children) : "";
}

const live = {
  id: "test-fixture-live-1",
  title: "測試直播",
  slug: "test-fixture-live",
  description: null,
  accentCopy: null,
  heroImageUrl: null,
  videoUrl: null,
  vendorId: "test-fixture-vendor-1",
  brand: { name: "測試品牌", logoUrl: null, primaryColor: "#000000", ctaColor: "#f97316" },
  form: null,
  interactionEvents: [],
  products: [
    { id: "test-fixture-product-1", name: "測試商品一", description: null, priceCents: 1000, compareAtCents: null, currency: "TWD", imageUrl: null, checkoutUrl: null, offerLabel: null },
    { id: "test-fixture-product-2", name: "測試商品二", description: null, priceCents: 2000, compareAtCents: null, currency: "TWD", imageUrl: null, checkoutUrl: null, offerLabel: null },
  ],
};

function renderLive() {
  hookState.cursor = 0;
  hookState.refCursor = 0;
  return LivePlayback({ live });
}

function checkoutButtons(tree: unknown) {
  return findElements(tree, (element) => (
    element.type === "button" && ["立即搶購", "結帳送出中...", "買", "送出中"].includes(textContent(element.props.children))
  ));
}

function checkoutErrors(tree: unknown) {
  return findElements(tree, (element) => element.props["aria-live"] === "polite");
}

describe("LivePlayback checkout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    hookState.cursor = 0;
    hookState.refCursor = 0;
    hookState.values = [];
    hookState.refs = [];
    vi.clearAllMocks();
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
        Version: "2.0",
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
      { type: "hidden", name: "Version", value: "2.0" },
      { type: "hidden", name: "EncryptInfo", value: "encrypted-payload" },
      { type: "hidden", name: "HashInfo", value: "signed-payload" },
    ]);
    expect(appendToBody).toHaveBeenCalledWith(form);
    expect(form.submit).toHaveBeenCalledOnce();
    expect(window.location.href).toBe("https://shop.example.test/product-checkout");
  });

  it.each(["javascript:alert(1)", "data:text/html,unsafe", "//attacker.example.test/path"])(
    "does not submit an unsafe provider form action %s",
    (formAction) => {
      const createElement = vi.fn();
      vi.stubGlobal("document", { createElement });

      expect(submitCheckout({
        formAction,
        formMethod: "POST",
        formPayload: { MerID: "merchant-123" },
      })).toBe(false);
      expect(createElement).not.toHaveBeenCalled();
    },
  );

  it("blocks unsafe CTA navigation even when legacy data already contains it", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    expect(openExternalUrl("javascript:alert(document.cookie)")).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(openExternalUrl("https://shop.example.test/offer")).toBe(true);
    expect(open).toHaveBeenCalledWith(
      "https://shop.example.test/offer",
      "_blank",
      "noopener,noreferrer",
    );
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

  it("shows a generic Traditional Chinese error when checkout fails or has no provider redirect action", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) }));

    await (checkoutButtons(renderLive())[0].props.onClick as () => Promise<void>)();
    let errors = checkoutErrors(renderLive());
    expect(errors).toHaveLength(1);
    expect(textContent(errors[0].props.children)).toBe("目前無法完成結帳，請稍後再試。");
    expect(textContent(errors[0].props.children)).not.toContain("PayUni");
    expect(textContent(errors[0].props.children)).not.toContain("Error");

    await (checkoutButtons(renderLive())[0].props.onClick as () => Promise<void>)();
    errors = checkoutErrors(renderLive());
    expect(errors).toHaveLength(1);
    expect(textContent(errors[0].props.children)).toBe("目前無法完成結帳，請稍後再試。");
  });

  it("clears a previous checkout error as soon as the user retries", async () => {
    let resolveCheckout: ((response: { ok: boolean }) => void) | undefined;
    const pendingResponse = new Promise<{ ok: boolean }>((resolve) => {
      resolveCheckout = resolve;
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockReturnValueOnce(pendingResponse));

    let tree = renderLive();
    await (checkoutButtons(tree)[0].props.onClick as () => Promise<void>)();
    expect(checkoutErrors(renderLive())).toHaveLength(1);

    tree = renderLive();
    const retry = (checkoutButtons(tree)[0].props.onClick as () => Promise<void>)();
    expect(checkoutErrors(renderLive())).toHaveLength(0);

    resolveCheckout?.({ ok: false });
    await retry;
  });

  it("does not show a checkout error when the provider redirect starts successfully", async () => {
    vi.stubGlobal("window", { location: { href: "https://app.example.test/live/demo" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ checkoutUrl: "https://checkout.example.test/redirect" }),
    }));

    const tree = renderLive();
    await (checkoutButtons(tree)[0].props.onClick as () => Promise<void>)();

    expect(window.location.href).toBe("https://checkout.example.test/redirect");
    expect(checkoutErrors(renderLive())).toHaveLength(0);
  });

  it("disables every checkout button while a checkout request is pending and prevents a second request", async () => {
    let resolveCheckout: ((response: { ok: boolean }) => void) | undefined;
    const checkoutResponse = new Promise<{ ok: boolean }>((resolve) => {
      resolveCheckout = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(checkoutResponse));

    let tree = renderLive();
    const productsTab = findElements(tree, (element) => element.type === "button" && textContent(element.props.children) === "商品")[0];
    (productsTab.props.onClick as () => void)();
    tree = renderLive();

    const initialButtons = checkoutButtons(tree);
    expect(initialButtons).toHaveLength(3);
    const firstCheckout = initialButtons[0].props.onClick as () => Promise<void>;
    const secondCheckout = initialButtons[1].props.onClick as () => Promise<void>;
    const pendingCheckout = firstCheckout();

    expect(fetch).toHaveBeenCalledOnce();
    expect(checkoutButtons(renderLive()).every((button) => button.props.disabled === true)).toBe(true);

    await secondCheckout();
    expect(fetch).toHaveBeenCalledOnce();

    expect(resolveCheckout).toBeDefined();
    resolveCheckout?.({ ok: false });
    await pendingCheckout;

    expect(checkoutButtons(renderLive()).every((button) => button.props.disabled === false)).toBe(true);
  });
});
