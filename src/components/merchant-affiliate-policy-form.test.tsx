// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MerchantAffiliateTerms } from "@/lib/affiliate-tier-policy";
import { MerchantAffiliatePolicyForm } from "./merchant-affiliate-policy-form";
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/app/actions/merchant-affiliate-policy-actions", () => ({ saveMerchantAffiliatePolicyAction: mocks.save }));

const baseTerms: MerchantAffiliateTerms = { schemaVersion: 1, currency: "TWD", maxTotalBps: 10000, tiers: [{ minQuantity: 1, maxQuantity: null, rateBps: 1000 }], uplines: [{ level: 1, rateBps: 500 }], productOverrides: [{ productId: "first", rateBps: 1000 }] };
const products = [{ id: "first", name: "商品一" }, { id: "second", name: "商品二" }];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  mocks.save.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

async function render(initial: MerchantAffiliateTerms | null = baseTerms, productList = products) {
  await act(async () => root.render(<MerchantAffiliatePolicyForm initial={initial} revision={1} csrfToken="synthetic" csrfFieldName="_csrf" products={productList} />));
}
/** 送出的欄位（比例欄位是隱藏欄位）。 */
const field = (name: string) => container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
/** 畫面上的控制項（比例輸入框沒有 name）。 */
const control = (key: string) => container.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-policy-field="${key}"]`)!;
async function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); });
}
const click = async (name: string) => { await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === name)!.click(); }); };
const submit = async () => { await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };

describe("merchant policy continuous publishing", () => {
  it("retains edited upline, product and rate after action success and the next publish", async () => {
    mocks.save.mockImplementation(async (_previous, data: FormData) => ({ message: "已發布", revision: Number(data.get("expectedRevision")) + 1 }));
    await render();
    await setValue(control("uplineRate-0"), "8"); await setValue(control("overrideRate-u0"), "12"); await setValue(control("overrideProduct-u0"), "second");
    expect(field("overrideProduct").value).toBe("second");
    for (const revision of [2, 3]) {
      await submit();
      expect(field("expectedRevision").value).toBe(String(revision));
      expect(field("uplineRate").value).toBe("8"); expect(field("overrideRate").value).toBe("12"); expect(field("overrideProduct").value).toBe("second");
      expect(control("uplineRate-0").value).toBe("8"); expect(control("overrideRate-u0").value).toBe("12");
      const submitted = mocks.save.mock.lastCall![1] as FormData;
      expect(submitted.get("uplineRate")).toBe("8"); expect(submitted.get("overrideRate")).toBe("12"); expect(submitted.get("overrideProduct")).toBe("second");
    }
  });
});

describe("比例以百分比顯示，送出值不經浮點", () => {
  it("已發布的 bps 顯示為最短百分比，輸入框沒有 name，送出值由隱藏欄位帶出", async () => {
    await render({ ...baseTerms, maxTotalBps: 3333, tiers: [{ minQuantity: 1, maxQuantity: null, rateBps: 1005 }], uplines: [{ level: 1, rateBps: 1050 }] });
    expect(control("maxTotalPercent").value).toBe("33.33");
    expect(control("tierRate-0").value).toBe("10.05");
    expect(control("uplineRate-0").value).toBe("10.5");
    for (const key of ["maxTotalPercent", "tierRate-0", "uplineRate-0", "overrideRate-u0"]) {
      expect(control(key).hasAttribute("name")).toBe(false);
      expect(control(key).getAttribute("inputmode")).toBe("decimal");
      expect(control(key).getAttribute("pattern")).toBe("0*\\d{1,3}(\\.\\d{1,2})?|\\.\\d{1,2}");
      expect((control(key) as HTMLInputElement).readOnly).toBe(false);
    }
    expect(field("maxTotalPercent").value).toBe("33.33");
    expect(field("tierRate").value).toBe("10.05");
  });

  it.each([
    [".5", "0.5"], ["0020", "20"], ["0.29", "0.29"], ["12.50", "12.5"], ["100", "100"],
    ["12.345", "invalid:12.345"], ["1e1", "invalid:1e1"], ["-1", "invalid:-1"], ["１２", "invalid:１２"], ["", ""],
  ])("輸入 %j → 送出 %j", async (typed, wire) => {
    await render();
    await setValue(control("tierRate-0"), typed);
    expect(control("tierRate-0").value).toBe(typed);
    expect(field("tierRate").value).toBe(wire);
  });

  it("合法的輸入照實送出：送給伺服器的 FormData 帶正規化後的百分比", async () => {
    mocks.save.mockResolvedValue({ message: "已發布", revision: 2 });
    await render();
    await setValue(control("tierRate-0"), ".5"); await setValue(control("maxTotalPercent"), "050");
    await submit();
    const submitted = mocks.save.mock.lastCall![1] as FormData;
    expect(submitted.getAll("tierRate")).toEqual(["0.5"]);
    expect(submitted.get("maxTotalPercent")).toBe("50");
  });
});

describe("hydrate 前（SSR）", () => {
  it("比例輸入框為 readOnly、沒有 name，隱藏欄位送出原值，並說明載入後才能修改", () => {
    const html = renderToStaticMarkup(<MerchantAffiliatePolicyForm initial={{ ...baseTerms, tiers: [{ minQuantity: 1, maxQuantity: 9, rateBps: 1234 }, { minQuantity: 10, maxQuantity: null, rateBps: 2050 }] }} revision={1} csrfToken="synthetic" csrfFieldName="_csrf" products={products} />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rateInputs = [...doc.querySelectorAll<HTMLInputElement>('[data-policy-field*="Rate"], [data-policy-field="maxTotalPercent"]')];
    expect(rateInputs).toHaveLength(5);
    for (const input of rateInputs) {
      expect(input.hasAttribute("readonly")).toBe(true);
      expect(input.hasAttribute("name")).toBe(false);
    }
    expect(doc.querySelector('[data-policy-field="tierRate-1"]')!.getAttribute("value")).toBe("20.5");
    expect([...doc.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="tierRate"]')].map(input => input.getAttribute("value"))).toEqual(["12.34", "20.5"]);
    expect(doc.querySelector('input[type="hidden"][name="maxTotalPercent"]')!.getAttribute("value")).toBe("100");
    expect(doc.querySelector("[data-policy-loading]")?.textContent).toBe("頁面載入完成後才能修改佣金比例。");
  });

  it("hydrate 後解除唯讀並移除說明", async () => {
    await render();
    expect((control("tierRate-0") as HTMLInputElement).readOnly).toBe(false);
    expect(container.querySelector("[data-policy-loading]")).toBeNull();
  });
});

describe("欄位層級錯誤", () => {
  it("階梯不連續時不送出，摘要列出具體列，焦點移到第 3 階起始件數", async () => {
    await render({ ...baseTerms, tiers: [{ minQuantity: 1, maxQuantity: 10, rateBps: 1000 }, { minQuantity: 11, maxQuantity: 20, rateBps: 1200 }, { minQuantity: 21, maxQuantity: null, rateBps: 1500 }] });
    await setValue(control("tierStart-2"), "25");
    await submit();
    expect(mocks.save).not.toHaveBeenCalled();
    const summary = container.querySelector("[data-form-error-summary]")!;
    expect(summary.getAttribute("role")).toBe("alert");
    expect(summary.textContent).toContain("發布前請先修正 1 個欄位。");
    expect([...summary.querySelectorAll("li")].map(item => item.textContent)).toEqual(["第 3 階起始件數：要接續上一階，填 21。"]);
    expect(document.activeElement).toBe(control("tierStart-2"));
    expect(control("tierStart-2").getAttribute("aria-invalid")).toBe("true");
    expect(control("tierStart-1").getAttribute("aria-invalid")).toBeNull();
    // 修正後錯誤即時消失，再送出就會呼叫伺服器。
    mocks.save.mockResolvedValue({ message: "已發布", revision: 2 });
    await setValue(control("tierStart-2"), "21");
    expect(container.querySelector("[data-form-error-summary]")).toBeNull();
    await submit();
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("超過 100% 與總上限：錯誤標在對應的比例欄位，焦點移到第一個", async () => {
    await render();
    await setValue(control("uplineRate-0"), "150");
    await submit();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(control("uplineRate-0").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(control("uplineRate-0"));
    const describedBy = control("uplineRate-0").getAttribute("aria-describedby")!.split(" ");
    expect(describedBy.map(id => document.getElementById(id)?.textContent)).toContain("請填 0 到 100 的數字，最多兩位小數。");
    await setValue(control("uplineRate-0"), "95.01");
    expect(control("maxTotalPercent").getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector("[data-form-error-summary]")!.textContent).toContain("佣金總比例上限：最高直接佣金 10% 加上線合計 95.01%，超過上限 100%。");
  });

  it("摘要的每一則錯誤都是連到那一列欄位的連結，點擊後聚焦該欄位", async () => {
    await render({ ...baseTerms, tiers: [{ minQuantity: 1, maxQuantity: 10, rateBps: 1000 }, { minQuantity: 11, maxQuantity: null, rateBps: 1500 }] });
    await setValue(control("tierStart-1"), "12");
    await setValue(control("uplineRate-0"), "150");
    await submit();
    const links = [...container.querySelectorAll<HTMLAnchorElement>("[data-form-error-summary] a[data-field-link]")];
    expect(links.map(link => [link.getAttribute("href"), link.textContent])).toEqual([
      ["#policy-field-tierStart-1", "第 2 階起始件數：要接續上一階，填 11。"],
      ["#policy-field-uplineRate-0", "第 1 層佣金：請填 0 到 100 的數字，最多兩位小數。"],
    ]);
    for (const link of links) expect(container.querySelector(link.getAttribute("href")!)).toBe(control(link.getAttribute("data-field-link")!));
    expect(document.activeElement).toBe(control("tierStart-1"));
    await act(async () => { links[1]!.click(); });
    expect(document.activeElement).toBe(control("uplineRate-0"));
  });

  it("瀏覽器原生驗證擋下時（不會觸發 submit）同樣標出欄位與摘要，焦點交給瀏覽器", async () => {
    await render();
    await setValue(control("tierRate-0"), "12.345");
    expect(control("tierRate-0").getAttribute("aria-invalid")).toBeNull();
    const before = document.activeElement;
    await act(async () => { control("tierRate-0").dispatchEvent(new Event("invalid", { cancelable: true })); });
    expect(control("tierRate-0").getAttribute("aria-invalid")).toBe("true");
    expect([...container.querySelectorAll("[data-form-error-summary] li")].map(item => item.textContent)).toEqual(["第 1 階直接佣金：請填 0 到 100 的數字，最多兩位小數。"]);
    expect(document.activeElement).toBe(before);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("商品佣金的錯誤指到那一列的商品選單", async () => {
    await render();
    await click("新增商品佣金");
    await submit();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(control("overrideProduct-u1"));
    expect([...container.querySelectorAll("[data-form-error-summary] li")].map(item => item.textContent)).toEqual(["佣金商品 2：請選擇商品。"]);
  });

  it("伺服器退回時顯示伺服器訊息並聚焦摘要；暫停不檢查政策內容", async () => {
    mocks.save.mockResolvedValue({ message: "無權設定政策，或所選商品不屬於此商家。", revision: null });
    await render();
    await submit();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const summary = container.querySelector<HTMLElement>("[data-form-error-summary]")!;
    expect(summary.textContent).toBe("無權設定政策，或所選商品不屬於此商家。");
    expect(document.activeElement).toBe(summary);

    mocks.save.mockResolvedValue({ message: "政策已暫停；既有結帳仍依原始政策計算。", revision: 2 });
    await setValue(control("tierRate-0"), "150");
    const pause = [...container.querySelectorAll("button")].find(button => button.textContent === "暫停新結帳政策")!;
    await act(async () => { container.querySelector("form")!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: pause })); });
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });
});

describe("商品佣金篩選", () => {
  const many = Array.from({ length: 8 }, (_, index) => ({ id: `p${index}`, name: index % 2 ? `課程 ${index}` : `實體 ${index}` }));
  it("篩選只隱藏列，所有商品佣金仍一起送出；有錯誤的列一律顯示", async () => {
    mocks.save.mockResolvedValue({ message: "已發布", revision: 2 });
    await render({ ...baseTerms, maxTotalBps: 10000, productOverrides: many.map((product, index) => ({ productId: product.id, rateBps: 100 * (index + 1) })) }, many);
    const filter = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await setValue(filter, "課程");
    const rows = [...container.querySelectorAll<HTMLLIElement>('[data-policy-row^="override-"]')];
    expect(rows.filter(row => !row.hidden)).toHaveLength(4);
    expect(container.querySelector("[data-override-filter-status]")!.textContent).toBe("顯示 4／8 筆；需要修正的商品一律顯示。");
    expect(filter.hasAttribute("name")).toBe(false);
    await submit();
    const submitted = mocks.save.mock.lastCall![1] as FormData;
    expect(submitted.getAll("overrideProduct")).toEqual(many.map(product => product.id));
    expect(submitted.getAll("overrideRate")).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(submitted.has("")).toBe(false);

    await setValue(filter, "");
    await setValue(control("overrideRate-u0"), "12.345");
    await setValue(filter, "課程");
    expect(container.querySelector<HTMLLIElement>('[data-policy-row="override-0"]')!.hidden).toBe(false);
  });
});

describe("佣金試算", () => {
  it("依目前表單設定試算，修改設定後即時更新；設定不合法時不顯示金額", async () => {
    await render({ schemaVersion: 1, currency: "TWD", maxTotalBps: 3000, tiers: [{ minQuantity: 1, maxQuantity: 10, rateBps: 1000 }, { minQuantity: 11, maxQuantity: null, rateBps: 2000 }], uplines: [{ level: 1, rateBps: 500 }], productOverrides: [] });
    const estimate = container.querySelector("#policy-estimate")!;
    expect(estimate.closest("form")).toBeNull();
    const inputs = [...estimate.querySelectorAll("input")];
    expect(inputs.every(input => !input.hasAttribute("name"))).toBe(true);
    await setValue(inputs[0]!, "15"); await setValue(inputs[1]!, "100");
    expect(estimate.querySelector('[data-estimate-level="0"]')!.textContent).toBe("NT$200.00");
    expect(estimate.querySelector('[data-estimate-level="1"]')!.textContent).toBe("NT$75.00");
    expect(estimate.querySelector("[data-estimate-total]")!.textContent).toBe("NT$275.00");
    expect(estimate.textContent).toContain("第 1–10 件 10%、第 11–15 件 20%");
    expect(estimate.textContent).toContain("僅供估算，實際依結算為準");

    await setValue(control("tierRate-1"), "25");
    expect(estimate.querySelector('[data-estimate-level="0"]')!.textContent).toBe("NT$225.00");
    await setValue(control("tierRate-1"), "26");
    expect(estimate.querySelector("[data-commission-estimate]")!.getAttribute("data-commission-estimate")).toBe("invalid-policy");
    expect(estimate.querySelector("[data-estimate-total]")).toBeNull();
  });
});
