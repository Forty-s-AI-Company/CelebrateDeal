"use client";

import { portalText } from "@/lib/student-portal-translations";
import type { StudentPortalLocale } from "@/lib/student-portal-locale";
import { useActionState } from "react";
import { requestMagicLinkAction } from "@/app/actions/student-portal-actions";
import { STUDENT_PORTAL_INITIAL_STATE } from "@/lib/student-portal-action-state";
export function StudentPortalLoginForm({
  vendorSlug,
  csrfToken,
  accentColor,
  locale = "zh-TW"
}: {
  locale?: StudentPortalLocale;
  vendorSlug: string;
  csrfToken: string;
  accentColor: string;
}) {
  const t = (text: string) => portalText(locale, text);
  const [state, action, pending] = useActionState(requestMagicLinkAction, STUDENT_PORTAL_INITIAL_STATE);
  return <form action={action} className="mt-8 space-y-5" aria-busy={pending}>
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="vendorSlug" value={vendorSlug} /><input type="hidden" name="locale" value={locale} />
      <label className="grid gap-2 text-sm font-semibold text-slate-800">
        Email
        <input name="email" type="email" inputMode="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" className="h-12 rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition placeholder:text-slate-500 focus:border-current focus:ring-4 focus:ring-blue-100" />
      </label>
      <button type="submit" disabled={pending} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-base font-bold text-white transition hover:brightness-95 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60" style={{
      backgroundColor: accentColor
    }}>
        {pending ? t("\u6B63\u5728\u6E96\u5099\u5B89\u5168\u9023\u7D50\u2026") : t("\u5BC4\u9001\u767B\u5165\u9023\u7D50")}
      </button>
      {state.status !== "idle" ? <div role={state.status === "invalid" ? "alert" : "status"} aria-live="polite" className={`rounded-xl p-4 text-sm leading-6 ${state.status === "sent" ? "bg-emerald-50 text-emerald-900" : "bg-orange-50 text-orange-950"}`}>
          <p>{t(state.message)}</p>
        </div> : null}
    </form>;
}
