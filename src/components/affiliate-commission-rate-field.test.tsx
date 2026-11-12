// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_COMMISSION_RATE_BPS } from "@/lib/affiliate-commission";
import { AFFILIATE_RATE_MAX_BPS, AffiliateCommissionRateField } from "./affiliate-commission-rate-field";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const visible = () => container.querySelector<HTMLInputElement>('[data-field-name="commissionRateBps"]')!;
const hidden = () => container.querySelector<HTMLInputElement>('input[type="hidden"][name="commissionRateBps"]')!;
async function render(initialBps: number) {
  await act(async () => root.render(<form><AffiliateCommissionRateField initialBps={initialBps} /></form>));
}
async function type(value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(visible(), value); visible().dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("聯盟夥伴佣金比例（百分比）", () => {
  it("上限與伺服器 MAX_COMMISSION_RATE_BPS 相同", () => {
    expect(AFFILIATE_RATE_MAX_BPS).toBe(MAX_COMMISSION_RATE_BPS);
  });

  it("SSR：輸入框 readOnly、沒有 name、顯示百分比；隱藏欄位送出原 bps", () => {
    const html = renderToStaticMarkup(<AffiliateCommissionRateField initialBps={3751} />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const input = doc.querySelector<HTMLInputElement>('[data-field-name="commissionRateBps"]')!;
    expect(input.hasAttribute("readonly")).toBe(true);
    expect(input.hasAttribute("name")).toBe(false);
    expect(input.getAttribute("value")).toBe("37.51");
    expect(doc.querySelector('input[type="hidden"][name="commissionRateBps"]')!.getAttribute("value")).toBe("3751");
    expect(doc.querySelector("[data-rate-loading]")?.textContent).toBe("頁面載入完成後才能修改。");
  });

  it("hydrate 後可編輯，標籤是唯一的無障礙名稱", async () => {
    await render(0);
    expect(visible().readOnly).toBe(false);
    expect(visible().value).toBe("0");
    expect(hidden().value).toBe("0");
    expect(container.querySelector("[data-rate-loading]")).toBeNull();
    expect(visible().closest("label")!.firstChild!.textContent!.trim()).toBe("佣金比例（%）");
    expect(visible().getAttribute("inputmode")).toBe("decimal");
    expect(visible().getAttribute("pattern")).toBe("0*\\d{1,3}(\\.\\d{1,2})?|\\.\\d{1,2}");
  });

  it.each([
    ["12.34", "1234"], [".5", "50"], ["0020", "2000"], ["0.01", "1"], ["100", "10000"], ["0.29", "29"],
  ])("輸入 %j 送出 %s bps", async (typed, wire) => {
    await render(500);
    await type(typed);
    expect(hidden().value).toBe(wire);
    expect(visible().getAttribute("aria-invalid")).toBeNull();
  });

  it.each(["", "12.345", "-1", "1e2", "１２", " 5"])("不合法的 %j 送出 invalid:（伺服器的 Number() 為 NaN，不會變成 0）", async (typed) => {
    await render(500);
    await type(typed);
    expect(hidden().value).toBe(`invalid:${typed}`);
    expect(Number(hidden().value.trim())).toBeNaN();
  });

  it("超過 100% 以自訂驗證擋下並在欄位旁說明；改回範圍內後解除", async () => {
    await render(500);
    await type("100.01");
    expect(hidden().value).toBe("10001");
    expect(visible().validationMessage).toBe("請填 0 到 100 的數字，最多兩位小數。");
    expect(visible().getAttribute("aria-invalid")).toBe("true");
    await type("100");
    expect(visible().validationMessage).toBe("");
    expect(visible().getAttribute("aria-invalid")).toBeNull();
  });
});
