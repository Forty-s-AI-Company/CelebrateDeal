"use client";

import { AlertTriangle, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useActionState, type ReactNode } from "react";
import {
  manageEmailDeliveriesAction,
  type EmailDeliveryOperationsActionState,
} from "@/app/actions/email-delivery-operations-actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Badge, Card } from "@/components/ui";
import { EMAIL_DELIVERY_QUERY_MAX_LENGTH } from "@/lib/email-delivery-operations-contract";

type EmailDeliveryListItem = NonNullable<EmailDeliveryOperationsActionState["result"]>["items"][number];

const controlClass = "h-11 rounded-md border border-border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100";
const primaryButtonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-dark";
const secondaryButtonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50";
const retryButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-orange-300 bg-orange-50 px-3 text-sm font-semibold text-orange-800 transition hover:bg-orange-100";

const statusPresentation: Record<string, { label: string; tone: "blue" | "orange" | "gray" | "green" | "red" }> = {
  queued: { label: "等待寄送", tone: "blue" },
  sending: { label: "寄送中", tone: "orange" },
  sent: { label: "已寄送", tone: "green" },
  failed: { label: "等待自動重試", tone: "orange" },
  exhausted: { label: "寄送失敗", tone: "red" },
  suppressed: { label: "已停止通知", tone: "gray" },
  superseded: { label: "已由新排程取代", tone: "gray" },
};

const triggerLabel: Record<string, string> = {
  registration_confirmed: "報名成功通知",
  form_submission_verification: "Email 驗證通知",
  live_reminder: "開播提醒",
  post_live_followup: "課後通知",
};

const errorGuidance: Record<string, string> = {
  configuration: "寄送服務尚未完成設定。修正設定後可重新排程。",
  network: "寄送服務連線暫時失敗，系統會自動重試。",
  provider_rejected: "寄送服務拒絕請求。請確認收件資訊或寄送設定；永久拒絕不開放直接重試。",
  invalid_response: "寄送服務回應異常。可稍後重新排程。",
  internal: "系統處理失敗。請稍後重試，若持續發生請聯絡客服。",
  stale_delivery_lease: "先前的寄送工作中斷，系統已回收並準備重試。",
  recipient_suppressed: "收件者已退訂，此信不會寄送。",
  config_superseded: "直播或模板設定已更新，舊排程不會寄送。",
  verification_superseded: "驗證已完成、連結已過期或已有新版驗證信。",
  schedule_superseded: "直播排程已更新，舊提醒不會寄送。",
};

function DeliveryBadge({ status }: { status: string }) {
  const presentation = statusPresentation[status] ?? { label: "未知狀態", tone: "gray" as const };
  return <Badge tone={presentation.tone}>{presentation.label}</Badge>;
}

function DeliveryDetails({ delivery }: { delivery: EmailDeliveryListItem }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-slate-950">{delivery.recipientMaskedEmail}</p>
        <DeliveryBadge status={delivery.status} />
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {triggerLabel[delivery.trigger] ?? "系統 Email"} · 建立於 {delivery.createdAtLabel}
      </p>
      <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{delivery.id}</p>
      <p className="mt-2 text-xs text-slate-500">
        本輪嘗試 {delivery.attemptCount}/{delivery.maxAttempts}
        {delivery.manualRetryCount > 0 ? ` · 人工重排 ${delivery.manualRetryCount} 次` : ""}
        {delivery.sentAtLabel ? ` · 寄送於 ${delivery.sentAtLabel}` : ""}
        {delivery.nextAttemptAtLabel ? ` · 預計處理 ${delivery.nextAttemptAtLabel}` : ""}
      </p>
      {delivery.lastManualRetryAtLabel ? <p className="mt-1 text-xs text-slate-500">最近人工重排：{delivery.lastManualRetryAtLabel}</p> : null}
      {delivery.lastErrorCode ? (
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
          <p className="font-semibold">{errorGuidance[delivery.lastErrorCode] ?? "寄送未完成，請稍後再查看狀態。"}</p>
          <p className="mt-1 font-mono text-[11px] text-red-700">診斷代碼：{delivery.lastErrorCode}</p>
        </div>
      ) : null}
    </div>
  );
}

function ResultRows({ result }: { result: NonNullable<EmailDeliveryOperationsActionState["result"]> }) {
  if (result.items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 px-5 py-10 text-center">
        <h2 className="font-semibold text-slate-900">沒有符合條件的寄送紀錄</h2>
        <p className="mt-2 text-sm text-slate-600">可清除部分條件後再查詢，既有排程不會受到影響。</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {result.items.map((delivery) => (
        <article key={delivery.id} className="rounded-lg border border-border p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <DeliveryDetails delivery={delivery} />
            {delivery.canRetry ? (
              <FormSubmitButton
                name="operation"
                value={`retry:${delivery.id}`}
                pendingChildren="排程中…"
                pendingMessage="正在安全地重新排入 Email 寄送佇列。"
                confirmMessage="要將這封信重新排入寄送佇列嗎？系統仍會再次檢查退訂與來源狀態。"
                className={retryButtonClass}
              >
                <RotateCcw size={16} aria-hidden="true" />重新排程
              </FormSubmitButton>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

export function EmailDeliveryOperationsWorkbench({
  initialState,
  csrfField,
}: {
  initialState: EmailDeliveryOperationsActionState;
  csrfField: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(manageEmailDeliveriesAction, initialState);
  // Server Action state is client-controlled on the round trip. When an action
  // fails closed, retain only the trusted Server Component snapshot rather
  // than echoing a submitted previousState result back into the page.
  const result = state.result ?? initialState.result;
  const isStaleSnapshot = state.status === "error" && state.result === null && result !== null;
  if (!result) {
    return <Card><p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">{state.message || "暫時無法載入寄送紀錄。"}</p></Card>;
  }

  const criteria = result.criteria;
  const attentionCount = (result.counts.failed ?? 0) + (result.counts.exhausted ?? 0);
  const filterKey = `${criteria.query}:${criteria.status}:${criteria.trigger}:${state.status}:${state.message}`;

  return (
    <form
      key={filterKey}
      action={formAction}
      aria-busy={pending}
      data-result-freshness={isStaleSnapshot ? "stale" : "current"}
      className="grid gap-4"
    >
      {csrfField}
      <input type="hidden" name="currentPage" value={result.page} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><p className="text-sm text-slate-500">全部寄送</p><p className="mt-2 text-2xl font-bold text-slate-950">{Object.entries(result.counts).filter(([key]) => key !== "activeSuppressions").reduce((sum, [, count]) => sum + count, 0)}</p></Card>
        <Card><p className="text-sm text-slate-500">需要注意</p><p className="mt-2 text-2xl font-bold text-orange-700">{attentionCount}</p></Card>
        <Card><p className="text-sm text-slate-500">已寄送</p><p className="mt-2 text-2xl font-bold text-green-700">{result.counts.sent ?? 0}</p></Card>
        <Card><p className="text-sm text-slate-500">有效退訂</p><p className="mt-2 text-2xl font-bold text-slate-700">{result.counts.activeSuppressions ?? 0}</p></Card>
      </div>

      <Card>
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><SlidersHorizontal size={17} aria-hidden="true" />查找寄送紀錄</div>
        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(18rem,1fr)_13rem_13rem_auto] xl:items-end">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            完整收件 Email 或寄送編號
            <input
              className={controlClass}
              name="query"
              type="search"
              defaultValue={criteria.query}
              maxLength={EMAIL_DELIVERY_QUERY_MAX_LENGTH}
              autoComplete="off"
              placeholder="name@example.com 或 email_…"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            寄送狀態
            <select className={controlClass} name="status" defaultValue={criteria.status}>
              <option value="ALL">全部狀態</option>
              <option value="ATTENTION">需要注意</option>
              <option value="queued">等待寄送</option>
              <option value="sending">寄送中</option>
              <option value="sent">已寄送</option>
              <option value="failed">等待自動重試</option>
              <option value="exhausted">寄送失敗</option>
              <option value="suppressed">已停止通知</option>
              <option value="superseded">已由新排程取代</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            通知類型
            <select className={controlClass} name="trigger" defaultValue={criteria.trigger}>
              <option value="ALL">全部類型</option>
              <option value="registration_confirmed">報名成功</option>
              <option value="form_submission_verification">Email 驗證</option>
              <option value="live_reminder">開播提醒</option>
              <option value="post_live_followup">課後通知</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <FormSubmitButton name="operation" value="search" pendingChildren="查詢中…" pendingMessage="正在查詢 Email 寄送紀錄。" className={primaryButtonClass}>
              <Search size={16} aria-hidden="true" />查詢
            </FormSubmitButton>
            <FormSubmitButton name="operation" value="reset" pendingChildren="清除中…" pendingMessage="正在清除查詢條件。" className={secondaryButtonClass}>
              清除
            </FormSubmitButton>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">完整 Email 只會在伺服器端轉成商家專屬雜湊後精確比對，不會寫入網址、寄送紀錄或畫面結果。</p>
      </Card>

      {state.status !== "idle" && state.message ? (
        <p role={state.status === "error" ? "alert" : "status"} aria-live="polite" className={`rounded-md px-4 py-3 text-sm ${state.status === "error" ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>
          {state.message}
          {isStaleSnapshot ? " 以下仍顯示上次成功載入的資料，本次條件尚未套用。" : ""}
        </p>
      ) : null}

      {attentionCount > 0 && criteria.status === "ALL" ? (
        <div className="flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          <AlertTriangle className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
          <p>目前有 {attentionCount} 筆需要注意。可切換「需要注意」查看；系統不會因手動操作繞過退訂或新版排程。</p>
        </div>
      ) : null}

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p role="status" aria-live="polite" className="text-sm text-slate-600">共 <strong className="text-slate-950">{result.totalItems}</strong> 筆，第 {result.page}／{result.totalPages} 頁</p>
          <p className="text-xs text-slate-500">每頁最多 {result.pageSize} 筆</p>
        </div>
        <ResultRows result={result} />
        {result.totalPages > 1 ? (
          <nav aria-label="Email 寄送紀錄分頁" className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
            <FormSubmitButton name="page" value={String(result.page - 1)} disabled={result.page <= 1} pendingChildren="載入中…" pendingMessage="正在載入上一頁寄送紀錄。" className={secondaryButtonClass}>上一頁</FormSubmitButton>
            <span className="text-sm text-slate-600">第 {result.page} 頁</span>
            <FormSubmitButton name="page" value={String(result.page + 1)} disabled={result.page >= result.totalPages} pendingChildren="載入中…" pendingMessage="正在載入下一頁寄送紀錄。" className={secondaryButtonClass}>下一頁</FormSubmitButton>
          </nav>
        ) : null}
      </Card>
    </form>
  );
}
