// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { MerchantAffiliatePolicyForm } from "./merchant-affiliate-policy-form";
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/app/actions/merchant-affiliate-policy-actions", () => ({ saveMerchantAffiliatePolicyAction: mocks.save }));

describe("merchant policy continuous publishing", () => {
  it("retains edited upline, product and rate after action success and the next publish", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    mocks.save.mockImplementation(async (_previous, data: FormData) => ({ message: "已發布", revision: Number(data.get("expectedRevision")) + 1 }));
    try {
      await act(async () => root.render(<MerchantAffiliatePolicyForm initial={{ schemaVersion: 1, currency: "TWD", maxTotalBps: 10000, tiers: [{ minQuantity: 1, maxQuantity: null, rateBps: 1000 }], uplines: [{ level: 1, rateBps: 500 }], productOverrides: [{ productId: "first", rateBps: 1000 }] }} revision={1} csrfToken="synthetic" csrfFieldName="_csrf" products={[{ id: "first", name: "商品一" }, { id: "second", name: "商品二" }]} />));
      const field = (name: string) => container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
      const change = async (name: string, value: string) => {
        const input = field(name);
        const prototype = input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        await act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
      };
      await change("uplineRate", "8"); await change("overrideRate", "12"); await change("overrideProduct", "second");
      expect(field("overrideProduct").value).toBe("second");
      for (const revision of [2, 3]) {
        await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
        expect(field("expectedRevision").value).toBe(String(revision));
        expect(field("uplineRate").value).toBe("8"); expect(field("overrideRate").value).toBe("12"); expect(field("overrideProduct").value).toBe("second");
        const submitted = mocks.save.mock.lastCall![1] as FormData;
        expect(submitted.get("uplineRate")).toBe("8"); expect(submitted.get("overrideRate")).toBe("12"); expect(submitted.get("overrideProduct")).toBe("second");
      }
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
