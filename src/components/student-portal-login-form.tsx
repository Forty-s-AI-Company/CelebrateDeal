"use client";

import { useActionState } from "react";
import {
  requestMagicLinkAction,
  STUDENT_PORTAL_INITIAL_STATE,
} from "@/app/actions/student-portal-actions";

export function StudentPortalLoginForm({ vendorSlug, csrfToken, accentColor }: { vendorSlug: string; csrfToken: string; accentColor: string }) {
  const [state, action, pending] = useActionState(requestMagicLinkAction, STUDENT_PORTAL_INITIAL_STATE);
  return (
    <form action={action} className="mt-8 space-y-5" aria-busy={pending}>
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="vendorSlug" value={vendorSlug} />
      <label className="grid gap-2 text-sm font-semibold text-slate-800">
        Email
        <input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={320}
          placeholder="you@example.com"
          className="h-12 rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition placeholder:text-slate-500 focus:border-current focus:ring-4 focus:ring-blue-100"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-base font-bold text-white transition hover:brightness-95 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
        style={{ backgroundColor: accentColor }}
      >
        {pending ? "正在準備安全連結…" : "寄送登入連結"}
      </button>
      {state.status !== "idle" ? (
        <div role={state.status === "invalid" ? "alert" : "status"} aria-live="polite" className={`rounded-xl p-4 text-sm leading-6 ${state.status === "sent" ? "bg-emerald-50 text-emerald-900" : "bg-orange-50 text-orange-950"}`}>
          <p>{state.message}</p>
          {state.mockLink ? <a className="mt-2 inline-flex min-h-11 items-center font-bold underline underline-offset-4" href={state.mockLink}>開發環境：開啟安全連結 →</a> : null}
        </div>
      ) : null}
    </form>
  );
}
