import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BillingPlanCheckoutForm } from "./billing-plan-checkout-form";

// F-083 / B05-09：Server Action 與金流相鄰表單不得再使用裸 <button>。
const GUARDED_FILES = [
  "src/app/affiliate-portal/[vendorSlug]/[affiliateId]/remuneration/page.tsx",
  "src/app/(app)/affiliates/[id]/remuneration/page.tsx",
  "src/app/(app)/affiliates/payout-policy/page.tsx",
  "src/app/(app)/affiliates/[id]/access/page.tsx",
  "src/app/(app)/products/[id]/lessons/page.tsx",
  "src/app/(app)/products/[id]/community/page.tsx",
  "src/app/(app)/consultations/mobile/page.tsx",
  "src/app/welcome/page.tsx",
  "src/app/checkout/result/page.tsx",
  "src/app/portal/[vendorSlug]/page.tsx",
  "src/components/student-portal-language-switcher.tsx",
  "src/components/billing-plan-checkout-form.tsx",
];

// 原生 POST 檔案下載會留在原頁，不能用會一直 pending 的按鈕；以及 method=get 的搜尋表單。
const ALLOWED_BARE_BUTTONS: Record<string, number> = {
  "src/app/(app)/affiliates/[id]/remuneration/page.tsx": 1,
  "src/app/(app)/affiliates/[id]/access/page.tsx": 1,
};

describe("F-083 表單送出按鈕", () => {
  it.each(GUARDED_FILES)("%s 使用 FormSubmitButton", (file) => {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    expect(source).toContain("FormSubmitButton");
    const bare = (source.match(/<button\b/g) ?? []).length;
    expect(bare).toBe(ALLOWED_BARE_BUTTONS[file] ?? 0);
  });
});

describe("BillingPlanCheckoutForm", () => {
  it("renders an enabled, non-busy submit button inside the native POST form", () => {
    const markup = renderToStaticMarkup(
      <BillingPlanCheckoutForm csrfToken="t" planId="plan_1" label="選擇此方案" />,
    );
    expect(markup).toContain('action="/api/billing/plans/select"');
    expect(markup).toContain('method="post"');
    expect(markup).toContain('name="planId"');
    expect(markup).toContain("選擇此方案");
    expect(markup).toContain('aria-busy="false"');
    expect(markup).toContain(`aria-disabled="false"`);
    expect(markup).toContain('role="status"');
  });
});

// 全面掃描：src/app 底下任何未標 type="button" 的原生 <button> 都會送出表單。
// 新增這類按鈕必須改用 FormSubmitButton／SubmitButton，或在此登記不需 pending 狀態的理由。
const GET_FORM = "method=get 的篩選／搜尋表單，只導覽不呼叫 Server Action，沒有 pending 狀態";
const ALLOWED_RAW_SUBMIT_BUTTONS: Record<string, { count: number; reason: string }> = {
  "src/app/(app)/affiliates/policy/page.tsx": { count: 1, reason: GET_FORM },
  "src/app/(app)/affiliates/[id]/access/page.tsx": { count: 1, reason: GET_FORM },
  "src/app/(app)/affiliates/[id]/remuneration/page.tsx": { count: 1, reason: "原生 POST 檔案下載會留在原頁，pending 按鈕會永遠不解除" },
  "src/app/(app)/forms/page.tsx": { count: 1, reason: GET_FORM },
  "src/app/(app)/interaction-scripts/page.tsx": { count: 1, reason: "每頁筆數的 GET 表單（未指定 method）" },
  "src/app/(app)/messages/templates/page.tsx": { count: 1, reason: GET_FORM },
  "src/app/(app)/orders/page.tsx": { count: 1, reason: GET_FORM },
  "src/app/(app)/products/page.tsx": { count: 1, reason: GET_FORM },
  "src/app/(app)/support-cases/page.tsx": { count: 1, reason: GET_FORM },
  "src/app/(app)/videos/page.tsx": { count: 1, reason: GET_FORM },
  "src/app/admin/vendor-features/page.tsx": { count: 1, reason: GET_FORM },
};

function listAppSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listAppSources(full);
    return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

/** 計算沒有 type="button"（或動態 type）的 <button> 開始標籤，可跨行。 */
function countRawSubmitButtons(source: string) {
  let count = 0;
  for (const match of source.matchAll(/<button\b([^>]*)/g)) {
    if (!/type=(?:"button"|'button'|\{)/.test(match[1] ?? "")) count += 1;
  }
  return count;
}

describe("F-083 src/app 全面掃描", () => {
  it("偵測得到裸 submit 按鈕，且不誤判 type=button", () => {
    expect(countRawSubmitButtons(`<button className="x">送出</button>`)).toBe(1);
    expect(countRawSubmitButtons(`<button type="submit">送出</button>`)).toBe(1);
    expect(countRawSubmitButtons(`<button\n  className="x"\n>送出</button>`)).toBe(1);
    expect(countRawSubmitButtons(`<button type="button" onClick={f}>x</button>`)).toBe(0);
    expect(countRawSubmitButtons(`<button\n  type="button"\n>x</button>`)).toBe(0);
    expect(countRawSubmitButtons(`<FormSubmitButton>x</FormSubmitButton>`)).toBe(0);
  });

  it("src/app 的裸 <button> 數量與白名單完全一致", () => {
    const root = process.cwd();
    const found: Record<string, number> = {};
    for (const file of listAppSources(path.join(root, "src/app"))) {
      const count = countRawSubmitButtons(readFileSync(file, "utf8"));
      if (count > 0) found[path.relative(root, file).split(path.sep).join("/")] = count;
    }
    const expected: Record<string, number> = {};
    for (const [file, { count, reason }] of Object.entries(ALLOWED_RAW_SUBMIT_BUTTONS)) {
      expect(reason.length).toBeGreaterThan(0);
      expected[file] = count;
    }
    expect(found).toEqual(expected);
  });
});
