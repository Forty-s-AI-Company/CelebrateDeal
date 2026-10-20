"use client";

import { useEffect, useState } from "react";
import { FormSubmitButton } from "@/components/form-submit-button";

const NATIVE_ACTION = "/api/billing/plans/select";

export function BillingPlanCheckoutForm({
  csrfToken,
  planId,
  referralClickId,
  label,
}: {
  csrfToken: string;
  planId: string;
  referralClickId?: string | null;
  label: string;
}) {
  // 原生 POST 導向沒有 Server Action，useFormStatus 不會回報 pending，
  // 因此在 submit 時自行鎖住按鈕；從 bfcache 返回時還原。
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setSubmitting(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  return (
    <form
      action={NATIVE_ACTION}
      method="post"
      onSubmit={(event) => {
        if (submitting) {
          event.preventDefault();
          return;
        }
        setSubmitting(true);
      }}
    >
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="planId" value={planId} />
      {referralClickId ? <input type="hidden" name="platformReferralClickId" value={referralClickId} /> : null}
      <FormSubmitButton
        pendingOverride={submitting}
        pendingChildren="前往結帳中…"
        pendingMessage="正在建立結帳，請勿重複送出。"
        className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-dark"
      >
        {label}
      </FormSubmitButton>
    </form>
  );
}
