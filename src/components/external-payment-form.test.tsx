import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pending: false,
  setPending: vi.fn(),
  submittedRef: { current: false },
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: () => [state.pending, state.setPending] as const,
    useRef: () => state.submittedRef,
  };
});

import { ExternalPaymentForm } from "./external-payment-form";

const props = {
  action: "https://sandbox-api.payuni.com.tw/api/upp",
  payload: { MerID: "synthetic-merchant", TradeInfo: "synthetic-payload" },
};

describe("ExternalPaymentForm", () => {
  beforeEach(() => {
    state.pending = false;
    state.setPending.mockClear();
    state.submittedRef.current = false;
  });

  it("preserves the sanitized provider form-post payload", () => {
    const html = renderToStaticMarkup(<ExternalPaymentForm {...props} />);

    expect(html).toContain('action="https://sandbox-api.payuni.com.tw/api/upp"');
    expect(html).toContain('method="post"');
    expect(html).toContain('target="_self"');
    expect(html).toContain('name="MerID" value="synthetic-merchant"');
    expect(html).toContain('name="TradeInfo" value="synthetic-payload"');
    expect(html).toContain("前往安全付款頁");
    expect(html).toContain('aria-disabled="false"');
  });

  it("protects a new-tab handoff from retaining opener access", () => {
    const html = renderToStaticMarkup(<ExternalPaymentForm {...props} target="_blank" />);

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("allows the first native submit and synchronously blocks a duplicate", () => {
    const tree = ExternalPaymentForm(props) as {
      props: { onSubmit: (event: { preventDefault: () => void }) => void };
    };
    const firstPreventDefault = vi.fn();
    const secondPreventDefault = vi.fn();

    tree.props.onSubmit({ preventDefault: firstPreventDefault });
    tree.props.onSubmit({ preventDefault: secondPreventDefault });

    expect(state.setPending).toHaveBeenCalledExactlyOnceWith(true);
    expect(firstPreventDefault).not.toHaveBeenCalled();
    expect(secondPreventDefault).toHaveBeenCalledExactlyOnceWith();
  });

  it("disables duplicate handoff submissions and announces navigation", () => {
    state.pending = true;
    const html = renderToStaticMarkup(<ExternalPaymentForm {...props} />);

    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在前往付款頁…");
    expect(html).toContain("正在安全傳送付款資料，請勿重複送出。");
  });
});
