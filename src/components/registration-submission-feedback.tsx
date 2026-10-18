"use client";

import { useEffect, useRef } from "react";

/** Keep live regions mounted and restore keyboard position after a failed submit. */
export function RegistrationSubmissionFeedback({ pending, errorMessage = "", successMessage = "", focusSuccess = false }: {
  pending: boolean;
  errorMessage?: string;
  successMessage?: string;
  focusSuccess?: boolean;
}) {
  const successRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (focusSuccess && successMessage && !pending && !errorMessage) successRef.current?.focus();
  }, [focusSuccess, successMessage, pending, errorMessage]);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const alert = errorRef.current;
    if (!errorMessage || pending || !alert) return;
    const active = alert.ownerDocument.activeElement;
    const form = alert.closest("form");
    // 不搶走使用者等待期間移往其他欄位或連結的焦點。
    const lostFocus = !active || active === alert.ownerDocument.body || active === alert;
    const onSubmit = active instanceof HTMLButtonElement && active.type === "submit" && active.form === form;
    if (lostFocus || onSubmit) alert.focus();
  }, [errorMessage, pending]);

  return <>
    <p ref={errorRef} tabIndex={-1} role="alert" aria-live="assertive" aria-atomic="true" className={`text-sm text-red-700 ${pending || !errorMessage ? "sr-only" : ""}`}>{pending ? "" : errorMessage}</p>
    <p ref={successRef} tabIndex={focusSuccess ? -1 : undefined} role="status" aria-live="polite" aria-atomic="true" className={pending || !successMessage || errorMessage ? "sr-only" : "text-sm text-emerald-700"}>{pending ? "正在送出，請勿重複操作。" : errorMessage ? "" : successMessage}</p>
  </>;
}
