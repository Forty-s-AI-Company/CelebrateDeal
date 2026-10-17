"use client";

import { useActionState } from "react";
import Image from "next/image";
import {
  saveLineOfficialAccountAction,
  testLineOfficialAccountAction,
  type LineConnectionActionState,
  type LineOfficialAccountActionState,
} from "@/app/actions/line-actions";
import { Card, SubmitButton } from "@/components/ui";

const initialState: LineOfficialAccountActionState = { status: "idle", error: null };
const initialConnectionState: LineConnectionActionState = { status: "idle", error: null, bot: null };

export function LineOfficialAccountForm({
  csrfToken,
  connected,
  webhookUrl,
  lastValidatedAt,
}: {
  csrfToken: string;
  connected: boolean;
  webhookUrl: string;
  lastValidatedAt: string | null;
}) {
  const [state, action, pending] = useActionState(saveLineOfficialAccountAction, initialState);
  const [connectionState, connectionAction, connectionPending] = useActionState(testLineOfficialAccountAction, initialConnectionState);
  const inputClass = "min-h-11 rounded-md border border-border bg-white px-3 py-2 text-sm text-slate-950";
  return (
    <Card className="space-y-5 p-6">
      <div>
        <h2 className="text-lg font-semibold">LINE Official Account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {connected ? "目前已綁定；更新時請重新填入完整憑證。" : "填入 LINE Developers Console 提供的通道憑證。"}
        </p>
      </div>
      <div className="grid gap-2 rounded-md border border-blue-100 bg-blue-50 p-4 text-sm text-slate-700">
        <h3 className="font-semibold text-slate-900">Webhook 設定</h3>
        <p>
          請在{" "}
          <a className="font-semibold text-blue-800 underline" href="https://developers.line.biz/console/" target="_blank" rel="noreferrer">
            LINE Developers Console
          </a>{" "}
          將下列網址設定為 Webhook URL，並開啟 Webhook：
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 break-all rounded border border-blue-200 bg-white px-3 py-2 text-xs">{webhookUrl}</code>
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-blue-300 bg-white px-3 text-sm font-semibold text-blue-800 hover:bg-blue-100"
            onClick={() => void navigator.clipboard?.writeText(webhookUrl)}
          >
            複製網址
          </button>
        </div>
        <p className="text-xs text-slate-600">路徑已綁定此商家，請勿與其他商家共用；在 LINE 後台完成 Verify 後再測試連線。</p>
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
      <div className="border-t border-border pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-medium">連線診斷</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {lastValidatedAt ? `上次驗證：${lastValidatedAt}` : "尚未驗證。只會回傳官方帳號名稱與頭像，不會顯示憑證。"}
            </p>
          </div>
          <form action={connectionAction}>
            <input type="hidden" name="_csrf" value={csrfToken} />
            <SubmitButton disabled={connectionPending || !connected} pendingChildren="測試中…">測試連線</SubmitButton>
          </form>
        </div>
        {connectionState.status === "validated" && connectionState.bot ? (
          <div className="mt-3 flex items-center gap-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
            {connectionState.bot.pictureUrl ? <Image unoptimized src={connectionState.bot.pictureUrl} alt="" width={40} height={40} className="h-10 w-10 rounded-full" /> : null}
            <span>連線成功：{connectionState.bot.displayName}</span>
          </div>
        ) : null}
        {connectionState.status === "error" ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {connectionState.error === "not_configured" ? "請先儲存 LINE 官方帳號憑證。" : "連線失敗，請確認 LINE 憑證與 Webhook 設定後再試。"}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
