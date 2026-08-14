import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const transition = vi.hoisted(() => ({ pending: false }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useTransition: () => [transition.pending, (callback: () => void) => callback()] as const,
  };
});

import MerchantBillingError from "@/app/(app)/billing/error";
import MerchantBillingLoading from "@/app/(app)/billing/loading";
import AdminBillingError from "@/app/admin/billing/error";
import AdminBillingLoading from "@/app/admin/billing/loading";

beforeEach(() => {
  transition.pending = false;
});

describe("finance route loading and error states", () => {
  it.each([
    ["admin", AdminBillingLoading, "正在載入財務作業資料"],
    ["merchant", MerchantBillingLoading, "正在載入商家帳務資料"],
  ])("renders an accessible %s loading state", (_scope, Component, message) => {
    const html = renderToStaticMarkup(<Component />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain(message);
    expect(html).toContain("完成前不會");
  });

  it.each([
    ["admin", AdminBillingError, "重新載入財務資料"],
    ["merchant", MerchantBillingError, "重新載入帳務資料"],
  ])("renders a safe recoverable %s error", (_scope, Component, retryLabel) => {
    const html = renderToStaticMarkup(<Component
      error={new Error("provider-secret-must-not-render")}
      unstable_retry={vi.fn()}
    />);

    expect(html).toContain('role="alert"');
    expect(html).toContain(retryLabel);
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain("provider-secret-must-not-render");
  });

  it.each([
    ["admin", AdminBillingError, "正在重新載入財務資料。"],
    ["merchant", MerchantBillingError, "正在重新載入商家帳務資料。"],
  ])("disables and announces a pending %s retry", (_scope, Component, pendingMessage) => {
    transition.pending = true;
    const html = renderToStaticMarkup(<Component
      error={new Error("hidden")}
      unstable_retry={vi.fn()}
    />);

    expect(html).toContain("disabled");
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("重新載入中…");
    expect(html).toContain(pendingMessage);
  });
});
