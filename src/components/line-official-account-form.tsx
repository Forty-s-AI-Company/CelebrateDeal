"use client";

import { useActionState } from "react";
import { saveLineOfficialAccountAction, type LineOfficialAccountActionState } from "@/app/actions/line-actions";
import { Card, SubmitButton } from "@/components/ui";

const initialState: LineOfficialAccountActionState = { status: "idle", error: null };

export function LineOfficialAccountForm({ csrfToken, connected }: { csrfToken: string; connected: boolean }) {
  const [state, action, pending] = useActionState(saveLineOfficialAccountAction, initialState);
  const inputClass = "min-h-11 rounded-md border border-border bg-white px-3 py-2 text-sm text-slate-950";
  return (
    <Card className="space-y-5 p-6">
      <div>
        <h2 className="text-lg font-semibold">LINE Official Account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {connected ? "目前已綁定；更新時請重新填入完整憑證。" : "填入 LINE Developers Console 提供的通道憑證。"}
        </p>
      </div>
      <form action={action} className="grid gap-4" autoComplete="off">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <label className="grid gap-1 text-sm font-medium">
          Messaging Channel ID
          <input className={inputClass} name="messagingChannelId" required maxLength={128} inputMode="numeric" />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Messaging Channel Secret
          <input className={inputClass} name="messagingChannelSecret" type="password" required minLength={16} maxLength={512} />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Messaging Access Token
          <input className={inputClass} name="messagingAccessToken" type="password" required minLength={32} maxLength={4096} />
        </label>
        <div className="border-t border-border pt-4">
          <h3 className="font-medium">LINE Login（選填，但兩欄需一起填）</h3>
        </div>
        <label className="grid gap-1 text-sm font-medium">
          Login Channel ID
          <input className={inputClass} name="loginChannelId" maxLength={128} inputMode="numeric" />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Login Channel Secret
          <input className={inputClass} name="loginChannelSecret" type="password" minLength={16} maxLength={512} />
        </label>
        {state.status === "saved" ? <p role="status" className="text-sm text-emerald-700">LINE 綁定已安全儲存。</p> : null}
        {state.status === "error" ? <p role="alert" className="text-sm text-destructive">憑證格式不完整，或目前無法儲存，請稍後再試。</p> : null}
        <SubmitButton disabled={pending} pendingChildren="儲存中…">{connected ? "更新 LINE 綁定" : "綁定 LINE"}</SubmitButton>
      </form>
    </Card>
  );
}
