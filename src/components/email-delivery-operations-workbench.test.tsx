import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailDeliveryOperationsActionState } from "@/app/actions/email-delivery-operations-actions";

const hookState = vi.hoisted(() => ({ actionState: null as EmailDeliveryOperationsActionState | null, pending: false }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useActionState: (_action: unknown, initialState: unknown) => [hookState.actionState ?? initialState, vi.fn(), hookState.pending],
  };
});
vi.mock("lucide-react", () => ({ AlertTriangle: () => <span />, RotateCcw: () => <span />, Search: () => <span />, SlidersHorizontal: () => <span /> }));
vi.mock("@/app/actions/email-delivery-operations-actions", () => ({ manageEmailDeliveriesAction: vi.fn() }));
vi.mock("@/components/form-submit-button", () => ({
  FormSubmitButton: ({ children, name, value, disabled }: { children: ReactNode; name?: string; value?: string; disabled?: boolean }) => <button type="submit" name={name} value={value} disabled={disabled}>{children}</button>,
}));

import { EmailDeliveryOperationsWorkbench } from "./email-delivery-operations-workbench";

const trusted: EmailDeliveryOperationsActionState = {
  status: "idle",
  message: "",
  result: {
    criteria: { query: "", status: "ALL", trigger: "ALL", page: 1 },
    items: [],
    counts: { failed: 1, activeSuppressions: 2 },
    totalItems: 0,
    page: 1,
    totalPages: 1,
    pageSize: 25,
  },
};

beforeEach(() => { hookState.actionState = null; hookState.pending = false; });

describe("EmailDeliveryOperationsWorkbench", () => {
  it("renders the successful action result instead of retaining the initial server list", () => {
    hookState.actionState = {
      status: "success",
      message: "找到 1 筆寄送紀錄。",
      result: {
        criteria: { query: "email_search_target", status: "failed", trigger: "registration_confirmed", page: 1 },
        items: [{
          id: "email_search_target",
          recipientMaskedEmail: "s***@example.test",
          status: "failed",
          trigger: "registration_confirmed",
          attemptCount: 1,
          maxAttempts: 5,
          manualRetryCount: 0,
          createdAtLabel: "2026/08/10 06:00",
          sentAtLabel: null,
          nextAttemptAtLabel: null,
          lastManualRetryAtLabel: null,
          lastErrorCode: "network",
          canRetry: true,
        }],
        counts: { failed: 1, activeSuppressions: 0 },
        totalItems: 1,
        page: 1,
        totalPages: 1,
        pageSize: 25,
      },
    };
    const html = renderToStaticMarkup(<EmailDeliveryOperationsWorkbench initialState={trusted} csrfField={null} />);
    expect(html).toContain("找到 1 筆寄送紀錄");
    expect(html).toContain("email_search_target");
    expect(html).toContain("s***@example.test");
    expect(html).toContain('value="failed" selected=""');
  });

  it("keeps trusted controls available after a fail-closed action without echoing submitted state", () => {
    hookState.actionState = { status: "error", message: "請輸入完整收件 Email 或完整寄送編號。", result: null };
    const html = renderToStaticMarkup(<EmailDeliveryOperationsWorkbench initialState={trusted} csrfField={<input name="_csrf" value="safe" readOnly />} />);
    expect(html).toContain("請輸入完整收件 Email 或完整寄送編號");
    expect(html).toContain('role="alert"');
    expect(html).toContain('name="query"');
    expect(html).toContain("寄送狀態");
    expect(html).toContain("通知類型");
    expect(html).toContain("查詢");
    expect(html).toContain('data-result-freshness="stale"');
    expect(html).toContain("本次條件尚未套用");
  });

  it("announces pending state and renders independent suppression visibility", () => {
    hookState.pending = true;
    const html = renderToStaticMarkup(<EmailDeliveryOperationsWorkbench initialState={trusted} csrfField={null} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("有效退訂");
    expect(html).toContain(">2<");
  });
});
