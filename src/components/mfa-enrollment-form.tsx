"use client";

import { useState, type ReactNode } from "react";

/**
 * Completes MFA enrollment through a native POST so the final
 * navigation does not depend on Next 16's same-route Server Action reducer.
 */
export function MfaEnrollmentForm({ csrfField }: { csrfField: ReactNode }) {
  const [pending, setPending] = useState(false);

  return (
    <form
      action="/api/settings/security/mfa/confirm"
      method="post"
      onSubmit={() => setPending(true)}
      className="grid gap-3"
    >
      {csrfField}
      <label className="grid gap-1.5 text-sm font-medium text-slate-700">
        6 位數驗證碼
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          required
          className="h-10 rounded-md border border-border px-3 tracking-[0.2em]"
          placeholder="123456"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        aria-disabled={pending}
        aria-busy={pending}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "啟用中…" : "啟用 MFA"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {pending ? "正在啟用 MFA，請勿重複送出。" : ""}
      </span>
    </form>
  );
}
