import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorManager: vi.fn(),
  parseInput: vi.fn(),
  loadResult: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/form-submission-search", () => ({
  parseFormSubmissionSearchInput: mocks.parseInput,
  loadFormSubmissionSearchResult: mocks.loadResult,
}));

import { searchFormSubmissionsAction, type FormSubmissionSearchActionState } from "./form-submission-search-actions";

const previousState: FormSubmissionSearchActionState = { status: "idle", message: "", result: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.parseInput.mockReturnValue({
    success: true,
    data: { formId: "form-1", query: "", verification: "ALL", source: "ALL", page: 1 },
  });
  mocks.loadResult.mockResolvedValue({
    form: { id: "form-1", name: "活動報名" },
    criteria: { formId: "form-1", query: "", verification: "ALL", source: "ALL", page: 1 },
    items: [], totalItems: 0, page: 1, totalPages: 1, pageSize: 25,
  });
});

describe("searchFormSubmissionsAction", () => {
  it("checks CSRF before authentication and returns a safe failure", async () => {
    mocks.assertServerActionSecurity.mockRejectedValue(new Error("raw csrf detail"));
    const result = await searchFormSubmissionsAction(previousState, new FormData());
    expect(result).toEqual({ status: "error", message: "安全驗證已失效，請重新整理頁面後再查詢。", result: null });
    expect(mocks.requireVendorManager).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("raw csrf detail");
  });

  it("does not authenticate or query when input validation fails", async () => {
    mocks.parseInput.mockReturnValue({ success: false, message: "查詢資料不完整。" });
    const result = await searchFormSubmissionsAction(previousState, new FormData());
    expect(result).toEqual({ status: "error", message: "查詢資料不完整。", result: null });
    expect(mocks.requireVendorManager).not.toHaveBeenCalled();
    expect(mocks.loadResult).not.toHaveBeenCalled();
  });

  it("re-derives vendor ownership and returns the bounded result", async () => {
    const result = await searchFormSubmissionsAction(previousState, new FormData());
    expect(mocks.loadResult).toHaveBeenCalledWith("vendor-1", expect.objectContaining({ formId: "form-1" }));
    expect(result.status).toBe("success");
    expect(result.message).toBe("沒有符合目前條件的報名資料。");
  });

  it("fails closed for inaccessible forms and database errors", async () => {
    mocks.loadResult.mockResolvedValueOnce(null);
    await expect(searchFormSubmissionsAction(previousState, new FormData())).resolves.toEqual({
      status: "error", message: "這張表單已不存在，或目前帳號沒有查看權限。", result: null,
    });
    mocks.loadResult.mockRejectedValueOnce(new Error("database host and private query"));
    const result = await searchFormSubmissionsAction(previousState, new FormData());
    expect(result).toEqual({ status: "error", message: "名單服務暫時無法使用，請稍後重試。", result: null });
    expect(JSON.stringify(result)).not.toContain("database host");
  });
});
