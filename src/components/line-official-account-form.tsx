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

export const lineFieldLabels: Record<string, string> = {
  messagingChannelId: "Messaging Channel ID",
  messagingChannelSecret: "Messaging Channel Secret",
  messagingAccessToken: "Messaging Access Token",
  loginChannelId: "Login Channel ID",
  loginChannelSecret: "Login Channel Secret",
};

export function describeLineSaveError(state: LineOfficialAccountActionState) {
  if (state.error === "save_failed") return "目前無法儲存 LINE 綁定，請稍後再試；若持續發生請聯絡客服。";
  const labels = (state.fields ?? []).map((field) => lineFieldLabels[field]).filter(Boolean);
  if (labels.length === 0) return "憑證格式不完整，請檢查每個欄位是否都已填寫。";
  return `以下欄位格式不正確或未填寫：${labels.join("、")}。請回 LINE Developers Console 重新複製後貼上。`;
}

const setupSteps = [
  "登入 LINE Developers Console，建立（或選擇）Provider 與 Messaging API channel，從 Basic settings 複製 Channel ID 與 Channel secret。",
  "在 Messaging API 分頁最下方按 Issue 產生 Channel access token（long-lived），並將下方 Webhook 網址貼到 Webhook URL、開啟 Use webhook。",
  "回到本頁把三個欄位貼上並按「綁定 LINE」，儲存後按「測試連線」，看到官方帳號名稱即代表完成。",
];
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
      <div className="grid gap-2 rounded-md border border-border bg-slate-50 p-4 text-sm text-slate-700">
        <h3 className="font-semibold text-slate-900">三步驟完成綁定</h3>
        <ol className="list-decimal space-y-1 pl-5">
          {setupSteps.map((step) => <li key={step}>{step}</li>)}
        </ol>
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
          <input className={inputClass} name="messagingChannelId" aria-invalid={state.fields?.includes("messagingChannelId") || undefined} required maxLength={128} inputMode="numeric" />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Messaging Channel Secret
          <input className={inputClass} name="messagingChannelSecret" aria-invalid={state.fields?.includes("messagingChannelSecret") || undefined} type="password" required minLength={16} maxLength={512} />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Messaging Access Token
          <input className={inputClass} name="messagingAccessToken" aria-invalid={state.fields?.includes("messagingAccessToken") || undefined} type="password" required minLength={32} maxLength={4096} />
        </label>
        <div className="border-t border-border pt-4">
          <h3 className="font-medium">LINE Login（選填，但兩欄需一起填）</h3>
        </div>
        <label className="grid gap-1 text-sm font-medium">
          Login Channel ID
          <input className={inputClass} name="loginChannelId" aria-invalid={state.fields?.includes("loginChannelId") || undefined} maxLength={128} inputMode="numeric" />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Login Channel Secret
          <input className={inputClass} name="loginChannelSecret" aria-invalid={state.fields?.includes("loginChannelSecret") || undefined} type="password" minLength={16} maxLength={512} />
        </label>
        {state.status === "saved" ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">LINE 綁定已安全儲存。下一步：按下方「測試連線」確認憑證有效。</p> : null}
        {state.status === "error" ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{describeLineSaveError(state)}</p> : null}
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
          <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
            {connectionState.error === "not_configured" ? "請先儲存 LINE 官方帳號憑證。" : "連線失敗，請確認 LINE 憑證與 Webhook 設定後再試。"}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
