"use client";

import { useActionState, useState, type ReactNode } from "react";
import { createMerchantInvitationAction } from "@/app/actions/merchant-invitation-actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { formatInvitationTime, type MerchantInvitationActionState } from "@/lib/merchant-invitation-admin";

const inputClassName = "mt-1 block min-h-11 w-full rounded-md border border-border bg-white px-3 text-sm";
const initialState: MerchantInvitationActionState = { status: "idle" };

function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="min-h-11 rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(link);
          setCopied("copied");
        } catch {
          setCopied("failed");
        }
      }}
    >
      {copied === "copied" ? "已複製" : copied === "failed" ? "無法複製，請手動選取" : "複製邀請連結"}
    </button>
  );
}

export function MerchantInvitationForm({ csrfField }: { csrfField: ReactNode }) {
  const [state, formAction, pending] = useActionState(createMerchantInvitationAction, initialState);
  return (
    <div className="grid gap-4">
      <form action={formAction} aria-busy={pending} className="grid gap-4 rounded-lg border border-border bg-white p-4 shadow-sm">
        {csrfField}
        <label className="text-sm font-semibold text-slate-700">
          受邀商家的 Email
          <input name="email" type="email" required maxLength={320} autoComplete="off" spellCheck={false} className={inputClassName} />
        </label>
        <div>
          <FormSubmitButton
            className="min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark"
            pendingChildren="產生中…"
            pendingMessage="正在產生邀請連結，請勿重複送出。"
          >
            產生邀請連結
          </FormSubmitButton>
        </div>
        {state.status === "error" ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</p> : null}
      </form>
      {state.status === "created" ? (
        <section aria-labelledby="merchant-invitation-result" className="rounded-lg border border-emerald-600 bg-white p-4 shadow-sm" data-invitation-result="created">
          <h2 id="merchant-invitation-result" className="font-semibold text-slate-950">已產生 {state.email} 的邀請連結</h2>
          <p role="status" className="mt-1 text-sm text-slate-600">有效期限至 {formatInvitationTime(state.expiresAt)}（台灣時間）。系統不會自動寄信，請自行寄給對方本人；拿到連結的人都能用這個 Email 註冊。</p>
          <label className="mt-3 block text-sm font-semibold text-slate-700">
            邀請連結
            <input readOnly value={state.link} onFocus={(event) => event.currentTarget.select()} className={`${inputClassName} font-mono text-xs`} />
          </label>
          <div className="mt-3"><CopyLinkButton key={state.link} link={state.link} /></div>
        </section>
      ) : null}
    </div>
  );
}
