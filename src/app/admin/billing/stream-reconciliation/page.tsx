import { FileCheck2, ShieldAlert } from "lucide-react";
import {
  importStreamUsageReconciliationAction,
  resolveStreamUsageReconciliationAction,
} from "./actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireFinanceAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

const inputClassName = "h-10 rounded-md border border-border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100";

const feedbackMessages: Record<string, string> = {
  imported: "已匯入經過遮罩處理的 provider 使用量證據，請覆核對帳結果。",
  duplicate: "相同摘要的證據已存在，未重複建立對帳紀錄。",
  resolved: "已記錄對帳決策；不會自動扣款或變更已鎖定帳務，未鎖定月結會依決策選用用量基準。",
};

const errorMessages: Record<string, string> = {
  conflict: "資料已被其他管理操作更新，請重新整理後再試一次。",
  invalid_input: "匯入資料或處理決策格式不正確，請確認月份、分鐘數、摘要、決策與人工備註。",
  not_found: "找不到指定的商家或對帳紀錄，請重新整理後再試一次。",
  invalid_transition: "只有仍為差異狀態的紀錄可以記錄處理決策。",
};

type PageSearchParams = {
  status?: string;
  error?: string;
};

function reconciliationTone(status: string) {
  if (status === "MATCHED" || status === "RESOLVED") return "green" as const;
  if (status === "MISMATCH") return "orange" as const;
  return "gray" as const;
}

function alertTone(severity: string) {
  return severity === "CRITICAL" ? "red" as const : "orange" as const;
}

function alertTypeLabel(type: string) {
  if (type === "QUOTA_WARNING") return "用量配額警示";
  if (type === "QUOTA_EXHAUSTED") return "用量配額已用盡";
  return "Provider 對帳差異";
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

export default async function AdminStreamReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  await requireFinanceAdmin();
  const { status, error } = await searchParams;
  const db = getDb();
  // Staging 的 transaction pool 可能只有單連線；此管理頁依序建立最小
  // read models，避免並發查詢讓已完成 MFA 的財務管理者遇到 P2024 timeout。
  const vendors = await db.vendor.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const reconciliations = await db.streamUsageReconciliation.findMany({
      orderBy: [{ monthKey: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        id: true,
        provider: true,
        monthKey: true,
        providerWatchMinutes: true,
        providerStorageMinutes: true,
        internalWatchMinutes: true,
        differenceMinutes: true,
        status: true,
        evidenceKind: true,
        resolution: true,
        sourceDigest: true,
        capturedAt: true,
        createdAt: true,
        vendor: { select: { name: true } },
      },
  });
  const openAlerts = await db.streamOperationsAlert.findMany({
      where: {
        status: "OPEN",
        type: { in: ["QUOTA_WARNING", "QUOTA_EXHAUSTED", "PROVIDER_DISCREPANCY"] },
      },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        id: true,
        type: true,
        severity: true,
        provider: true,
        monthKey: true,
        message: true,
        createdAt: true,
        vendor: { select: { name: true } },
      },
  });

  const feedback = status ? feedbackMessages[status] : null;
  const safeError = error ? errorMessages[error] ?? "此次操作未完成，請確認欄位並重新嘗試。" : null;

  return (
    <>
      <PageHeader
        title="Stream 使用量對帳"
        description="匯入已去識別化的 provider 使用量證據，與平台內部帳本比對並保留人工決策。"
      />

      {feedback ? <p className="mb-6 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{feedback}</p> : null}
      {safeError ? <p className="mb-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{safeError}</p> : null}

      <Card className="mb-6">
        <div className="flex items-start gap-3">
          <FileCheck2 className="mt-0.5 text-primary" size={20} aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold text-slate-950">匯入 sanitized provider evidence</h2>
            <p className="mt-1 text-sm text-slate-600">請勿貼上 raw provider payload、帳號 ID、API key、secret 或其他憑證；只匯入彙總分鐘數與報表摘要。</p>
          </div>
        </div>
        <form action={importStreamUsageReconciliationAction} className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <CsrfField />
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            商家
            <select name="vendorId" required defaultValue="" className={inputClassName}>
              <option value="" disabled>選擇商家</option>
              {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            Provider
            <input name="provider" value="CLOUDFLARE" readOnly aria-readonly="true" className={`${inputClassName} bg-slate-50`} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            月份
            <input name="monthKey" type="month" required defaultValue={currentMonthKey()} className={inputClassName} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            Provider delivered minutes
            <input name="providerWatchMinutes" type="number" required min="0" step="1" inputMode="numeric" className={inputClassName} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            Storage minutes（選填）
            <input name="providerStorageMinutes" type="number" min="0" step="1" inputMode="numeric" className={inputClassName} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            Captured at
            <input name="capturedAt" type="text" required placeholder="2026-08-01T00:00:00Z" pattern="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})" className={inputClassName} />
            <span className="text-xs font-normal text-slate-500">ISO 8601，必須包含 `Z` 或時區 offset。</span>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            Source digest（SHA-256）
            <input name="sourceDigest" required minLength={64} maxLength={64} pattern="[A-Fa-f0-9]{64}" spellCheck={false} autoComplete="off" className={inputClassName} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700 xl:col-span-3">
            Source reference（選填，1–120 字）
            <input name="sourceReference" minLength={1} maxLength={120} placeholder="例如：2026-08 用量報表摘要" className={inputClassName} />
          </label>
          <div className="flex items-end">
            <FormSubmitButton pendingChildren="匯入中…" pendingMessage="正在匯入使用量證據，請勿重複送出。" className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">
              匯入對帳證據
            </FormSubmitButton>
          </div>
        </form>
      </Card>

      <Card className="mb-6 overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-950">最新 reconciliation</h2>
          <p className="mt-1 text-sm text-slate-600">匯入本身不會自動扣款；人工決策可影響未鎖定月結採用的 Stream 用量基準，但不能變更已鎖定帳務。</p>
        </div>
        {reconciliations.length === 0 ? (
          <div className="p-5"><EmptyState title="尚無對帳紀錄" description="尚未匯入任何已去識別化的 provider 使用量證據。" /></div>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Stream 使用量對帳表格，可水平捲動">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr><th className="px-5 py-3">商家／月份</th><th className="px-5 py-3">Provider</th><th className="px-5 py-3">分鐘（provider／internal／差異）</th><th className="px-5 py-3">狀態</th><th className="px-5 py-3">Digest</th><th className="px-5 py-3">Captured／imported</th><th className="px-5 py-3">人工決策</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reconciliations.map((item) => (
                  <tr key={item.id} className="align-top hover:bg-slate-50/70">
                    <td className="px-5 py-4 font-semibold text-slate-950">{item.vendor.name}<span className="mt-1 block font-normal text-slate-500">{item.monthKey}</span></td>
                    <td className="px-5 py-4">{item.provider}</td>
                    <td className="px-5 py-4 tabular-nums">{item.providerWatchMinutes}／{item.internalWatchMinutes}／{item.differenceMinutes}</td>
                    <td className="px-5 py-4"><Badge tone={reconciliationTone(item.status)}>{item.status}</Badge>{item.resolution ? <span className="mt-1 block text-xs text-slate-500">{item.resolution}</span> : null}</td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-600" title="SHA-256 digest 前 12 碼">{item.sourceDigest.slice(0, 12)}<span className="mt-1 block font-sans">{item.evidenceKind === "ADMIN_ATTESTED_DIGEST" ? "admin attested（非 provider 簽章）" : item.evidenceKind}</span></td>
                    <td className="px-5 py-4 text-xs text-slate-600">{formatDateTime(item.capturedAt)}<span className="mt-1 block">匯入 {formatDateTime(item.createdAt)}</span></td>
                    <td className="px-5 py-4">
                      {item.status === "MISMATCH" ? (
                        <form action={resolveStreamUsageReconciliationAction} className="grid min-w-[260px] gap-2">
                          <CsrfField />
                          <input type="hidden" name="id" value={item.id} />
                          <label className="sr-only" htmlFor={`resolution-${item.id}`}>處理決策</label>
                          <select id={`resolution-${item.id}`} name="resolution" required defaultValue="" className={inputClassName}>
                            <option value="" disabled>選擇決策</option><option value="ACCEPT_INTERNAL">ACCEPT_INTERNAL</option><option value="ACCEPT_PROVIDER">ACCEPT_PROVIDER</option><option value="ESCALATED">ESCALATED</option>
                          </select>
                          <label className="sr-only" htmlFor={`note-${item.id}`}>決策備註</label>
                          <textarea id={`note-${item.id}`} name="note" required minLength={10} maxLength={500} rows={3} placeholder="10–500 字人工覆核備註" className="rounded-md border border-border px-3 py-2 text-sm" />
                          <FormSubmitButton confirmMessage="這項決策可能影響未鎖定月結的 Stream 用量基準。確認已核對摘要雜湊與分鐘數？" pendingChildren="記錄中…" pendingMessage="正在記錄人工決策，請勿重複送出。" className="inline-flex h-9 items-center justify-center rounded-md border border-border px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">記錄決策</FormSubmitButton>
                        </form>
                      ) : <span className="text-xs text-slate-500">不需要處理</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 text-orange-600" size={20} aria-hidden="true" />
          <div><h2 className="text-lg font-semibold text-slate-950">OPEN StreamOperationsAlert</h2><p className="mt-1 text-sm text-slate-600">僅列出配額與 provider 差異的待處理警示。</p></div>
        </div>
        {openAlerts.length === 0 ? <p className="mt-4 rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-600">目前沒有開放中的配額或差異警示。</p> : (
          <ul className="mt-4 grid gap-3" aria-label="開放中的 Stream 操作警示">
            {openAlerts.map((alert) => <li key={alert.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"><div><p className="font-semibold text-slate-950">{alert.vendor.name} · {alertTypeLabel(alert.type)}</p><p className="mt-1 text-sm text-slate-700">{alert.message}</p><p className="mt-1 text-xs text-slate-500">{alert.monthKey} · {alert.provider ?? "內部使用量"} · 建立 {formatDateTime(alert.createdAt)}</p></div><Badge tone={alertTone(alert.severity)}>{alert.severity}</Badge></li>)}
          </ul>
        )}
      </Card>
    </>
  );
}
