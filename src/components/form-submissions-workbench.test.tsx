import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reactState = vi.hoisted(() => ({ pending: false }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useActionState: (_action: unknown, initialState: unknown) => [initialState, vi.fn(), reactState.pending],
  };
});
vi.mock("lucide-react", () => ({ Search: () => <span>search-icon</span>, SlidersHorizontal: () => <span>filter-icon</span> }));
vi.mock("@/app/actions/form-submission-search-actions", () => ({ searchFormSubmissionsAction: vi.fn() }));
vi.mock("@/components/form-submit-button", () => ({
  FormSubmitButton: ({ children, name, value, disabled }: { children: ReactNode; name?: string; value?: string; disabled?: boolean }) => (
    <button type="submit" name={name} value={value} disabled={disabled}>{children}</button>
  ),
}));

import { FormSubmissionsWorkbench } from "./form-submissions-workbench";
import type { FormSubmissionSearchActionState } from "@/app/actions/form-submission-search-actions";

function state(overrides: Partial<NonNullable<FormSubmissionSearchActionState["result"]>> = {}): FormSubmissionSearchActionState {
  return {
    status: "idle",
    message: "",
    result: {
      form: { id: "form-1", name: "活動報名" },
      criteria: { formId: "form-1", query: "eden", verification: "VERIFIED", source: "LIVE", page: 1 },
      items: [{
        id: "submission-1",
        name: "王小明",
        email: "safe@example.test",
        phone: null,
        source: "form",
        liveTitle: "八月直播",
        verificationStatus: "VERIFIED",
        createdAtLabel: "2026年8月10日 09:00",
      }],
      totalItems: 51,
      page: 1,
      totalPages: 3,
      pageSize: 25,
      ...overrides,
    },
  };
}

beforeEach(() => { reactState.pending = false; });

describe("FormSubmissionsWorkbench", () => {
  it("renders private POST-style search controls, responsive results, and bounded pagination", () => {
    const html = renderToStaticMarkup(<FormSubmissionsWorkbench initialState={state()} csrfField={<input type="hidden" name="csrf" value="safe" />} />);
    expect(html).toContain("姓名、Email 或手機");
    expect(html).toContain("name=\"query\"");
    expect(html).toContain("value=\"eden\"");
    expect(html).toContain("value=\"VERIFIED\" selected=\"\"");
    expect(html).toContain("value=\"LIVE\" selected=\"\"");
    expect(html).toContain("不會寫入瀏覽器網址與歷史紀錄");
    expect(html).toContain("王小明");
    expect(html).toContain("safe@example.test");
    expect(html).toContain("八月直播");
    expect(html).toContain("未提供");
    expect(html).toContain("共 <strong");
    expect(html).toContain("51");
    expect(html).toContain("上一頁");
    expect(html).toContain("下一頁");
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("aria-label=\"名單分頁\"");
    expect(html).toContain("name=\"resetFilters\"");
    expect(html).not.toContain("name=\"reset\"");
  });

  it("shows an actionable empty state without removing filters", () => {
    const html = renderToStaticMarkup(<FormSubmissionsWorkbench initialState={state({ items: [], totalItems: 0, totalPages: 1 })} csrfField={null} />);
    expect(html).toContain("沒有符合條件的報名資料");
    expect(html).toContain("清除條件");
    expect(html).not.toContain("名單分頁");
  });

  it("exposes pending and safe load failures to assistive technology", () => {
    reactState.pending = true;
    const pendingHtml = renderToStaticMarkup(<FormSubmissionsWorkbench initialState={state()} csrfField={null} />);
    expect(pendingHtml).toContain("aria-busy=\"true\"");

    const errorHtml = renderToStaticMarkup(<FormSubmissionsWorkbench initialState={{ status: "error", message: "名單服務暫時無法使用。", result: null }} csrfField={null} />);
    expect(errorHtml).toContain("role=\"alert\"");
    expect(errorHtml).toContain("名單服務暫時無法使用");
  });
});
