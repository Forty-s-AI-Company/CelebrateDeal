import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const formStatus = vi.hoisted(() => ({ pending: false }));

vi.mock("react-dom", async (importOriginal) => {
  const reactDom = await importOriginal<typeof import("react-dom")>();
  return {
    ...reactDom,
    useFormStatus: () => ({ pending: formStatus.pending }),
  };
});

import { PlanSubmitButton } from "./plan-submit-button";

describe("PlanSubmitButton", () => {
  beforeEach(() => {
    formStatus.pending = false;
  });

  it("renders the normal plan purchase action", () => {
    const html = renderToStaticMarkup(<PlanSubmitButton label="選擇方案" />);

    expect(html).toContain("選擇方案");
    expect(html).toContain('aria-disabled="false"');
    expect(html).not.toContain("建立付款中");
  });

  it("disables duplicate purchase submissions and announces the exact operation", () => {
    formStatus.pending = true;
    const html = renderToStaticMarkup(<PlanSubmitButton label="選擇方案" />);

    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("建立付款中…");
    expect(html).toContain("正在建立方案付款，請勿重複送出。");
  });

  it("distinguishes a plan change from a first purchase while pending", () => {
    formStatus.pending = true;
    const html = renderToStaticMarkup(<PlanSubmitButton label="變更方案" />);

    expect(html).toContain("建立變更付款中…");
    expect(html).toContain("正在建立方案變更付款，請勿重複送出。");
  });
});
