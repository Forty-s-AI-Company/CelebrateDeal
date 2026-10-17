"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { RegistrationRetryDraft } from "@/lib/registration-form-retry";
import { formSubmissionErrorMessage } from "@/lib/registration-submission-client";
import type { RegistrationAttribution } from "@/lib/registration-attribution";

type RetryState = { formId?: string; sourcePath: string; draft: RegistrationRetryDraft | null; failed: boolean; submitted?: boolean; attribution?: RegistrationAttribution };
const Context = createContext<RetryState | null>(null);
export function RegistrationRetryProvider({ value, children }: { value: RetryState; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useRegistrationRetry(formId: string) {
  const state = useContext(Context);
  if (!state || state.formId !== formId) return null;
  // 網址可被分享或保留；沒有有效草稿時，不把網址旗標當成送出失敗的證據。
  return { ...state, message: state.failed ? state.draft ? formSubmissionErrorMessage(state.draft.status) : "目前沒有可恢復的填寫內容，無法確認先前的送出結果。若您已報名，請先查看確認信，避免重複送出；若尚未報名，請重新填寫。" : "" };
}
