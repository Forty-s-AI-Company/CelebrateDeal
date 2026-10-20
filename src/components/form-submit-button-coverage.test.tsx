import { readFileSync } from "node:fs";
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
