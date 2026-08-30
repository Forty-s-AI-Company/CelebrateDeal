"use server";

import { requireVendorManager } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import {
  loadFormSubmissionSearchResult,
  parseFormSubmissionSearchInput,
  type FormSubmissionSearchResult,
} from "@/lib/form-submission-search";

export type FormSubmissionSearchActionState = {
  status: "idle" | "success" | "error";
  message: string;
  result: FormSubmissionSearchResult | null;
};

export async function searchFormSubmissionsAction(
  _previousState: FormSubmissionSearchActionState,
  formData: FormData,
): Promise<FormSubmissionSearchActionState> {
  try {
    await assertServerActionSecurity(formData);
  } catch {
    return {
      status: "error",
      message: "安全驗證已失效，請重新整理頁面後再查詢。",
      result: null,
    };
  }

  const parsed = parseFormSubmissionSearchInput(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.message, result: null };
  }

  const vendor = await requireVendorManager();
  try {
    const result = await loadFormSubmissionSearchResult(vendor.id, parsed.data);
    if (!result) {
      return {
        status: "error",
        message: "這張表單已不存在，或目前帳號沒有查看權限。",
        result: null,
      };
    }
    return {
      status: "success",
      message: result.totalItems === 0 ? "沒有符合目前條件的報名資料。" : `找到 ${result.totalItems} 筆報名資料。`,
      result,
    };
  } catch {
    return {
      status: "error",
      message: "名單服務暫時無法使用，請稍後重試。",
      result: null,
    };
  }
}
