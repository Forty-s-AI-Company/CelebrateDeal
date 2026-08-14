"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useActionState, type ReactNode } from "react";
import {
  searchFormSubmissionsAction,
  type FormSubmissionSearchActionState,
} from "@/app/actions/form-submission-search-actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Badge, Card } from "@/components/ui";
import { FORM_SUBMISSION_QUERY_MAX_LENGTH } from "@/lib/form-submission-search";

const controlClass = "h-11 rounded-md border border-border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100";
const primaryButtonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-dark";
const secondaryButtonClass = "inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50";

function VerificationBadge({ status }: { status: "VERIFIED" | "UNVERIFIED" }) {
  return <Badge tone={status === "VERIFIED" ? "green" : "gray"}>{status === "VERIFIED" ? "已驗證" : "待驗證"}</Badge>;
}

function ResultRows({ result }: { result: NonNullable<FormSubmissionSearchActionState["result"]> }) {
  if (result.items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 px-5 py-10 text-center">
        <h2 className="font-semibold text-slate-900">沒有符合條件的報名資料</h2>
        <p className="mt-2 text-sm text-slate-600">可清除部分條件後再查詢；既有名單不會受到影響。</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-3 md:hidden">
        {result.items.map((submission) => (
          <article key={submission.id} className="rounded-lg border border-border p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold text-slate-950 [overflow-wrap:anywhere]">{submission.name}</h2>
              <VerificationBadge status={submission.verificationStatus} />
            </div>
            <dl className="mt-3 grid gap-2 text-slate-700">
              <div><dt className="text-xs font-semibold text-slate-500">Email</dt><dd className="[overflow-wrap:anywhere]">{submission.email}</dd></div>
              <div><dt className="text-xs font-semibold text-slate-500">手機</dt><dd>{submission.phone || "未提供"}</dd></div>
              <div><dt className="text-xs font-semibold text-slate-500">來源</dt><dd className="[overflow-wrap:anywhere]">{submission.liveTitle ?? submission.source}</dd></div>
              <div><dt className="text-xs font-semibold text-slate-500">報名時間</dt><dd>{submission.createdAtLabel}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="py-2 pr-4">姓名</th>
              <th className="pr-4">Email</th>
              <th className="pr-4">手機</th>
              <th className="pr-4">來源</th>
              <th className="pr-4">驗證</th>
              <th>時間</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((submission) => (
              <tr key={submission.id} className="border-t border-border align-top">
                <td className="py-3 pr-4 font-medium text-slate-950">{submission.name}</td>
                <td className="py-3 pr-4 [overflow-wrap:anywhere]">{submission.email}</td>
                <td className="py-3 pr-4">{submission.phone || "未提供"}</td>
                <td className="py-3 pr-4">{submission.liveTitle ?? submission.source}</td>
                <td className="py-3 pr-4"><VerificationBadge status={submission.verificationStatus} /></td>
                <td className="py-3 whitespace-nowrap">{submission.createdAtLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function FormSubmissionsWorkbench({
  initialState,
  csrfField,
}: {
  initialState: FormSubmissionSearchActionState;
  csrfField: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(searchFormSubmissionsAction, initialState);
  const result = state.result;
  if (!result) {
    return (
      <Card>
        <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">{state.message || "暫時無法載入名單，請重新整理頁面。"}</p>
      </Card>
    );
  }

  const { criteria } = result;
  const filterKey = `${criteria.query}:${criteria.verification}:${criteria.source}`;

  return (
    <form id="form-submissions-search" key={filterKey} action={formAction} aria-busy={pending} className="grid gap-4">
      {csrfField}
      <input type="hidden" name="formId" value={result.form.id} />
      <Card>
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><SlidersHorizontal size={17} aria-hidden="true" />查找名單</div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_12rem_12rem_auto] lg:items-end">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            姓名、Email 或手機
            <input
              className={controlClass}
              name="query"
              defaultValue={criteria.query}
              maxLength={FORM_SUBMISSION_QUERY_MAX_LENGTH}
              autoComplete="off"
              placeholder="輸入關鍵字"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            驗證狀態
            <select className={controlClass} name="verification" defaultValue={criteria.verification}>
              <option value="ALL">全部</option>
              <option value="VERIFIED">已驗證</option>
              <option value="UNVERIFIED">待驗證</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            報名來源
            <select className={controlClass} name="source" defaultValue={criteria.source}>
              <option value="ALL">全部</option>
              <option value="LIVE">直播頁</option>
              <option value="FORM">獨立表單</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <FormSubmitButton
              name="page"
              value="1"
              pendingChildren="查詢中…"
              pendingMessage="正在查詢報名名單。"
              className={primaryButtonClass}
            >
              <Search size={16} aria-hidden="true" />查詢
            </FormSubmitButton>
            <FormSubmitButton
              name="resetFilters"
              value="1"
              pendingChildren="清除中…"
              pendingMessage="正在清除查詢條件。"
              className={secondaryButtonClass}
            >
              清除條件
            </FormSubmitButton>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">搜尋條件以安全表單送出，不會寫入瀏覽器網址與歷史紀錄。</p>
      </Card>

      {state.status === "error" ? <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">{state.message}</p> : null}
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p role="status" aria-live="polite" className="text-sm text-slate-600">
            共 <strong className="text-slate-950">{result.totalItems}</strong> 筆，第 {result.page}／{result.totalPages} 頁
          </p>
          <p className="text-xs text-slate-500">每頁最多 {result.pageSize} 筆</p>
        </div>
        <ResultRows result={result} />
        {result.totalPages > 1 ? (
          <nav aria-label="名單分頁" className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
            <FormSubmitButton
              name="page"
              value={String(result.page - 1)}
              disabled={result.page <= 1}
              pendingChildren="載入中…"
              pendingMessage="正在載入上一頁名單。"
              className={secondaryButtonClass}
            >
              上一頁
            </FormSubmitButton>
            <span className="text-sm text-slate-600">第 {result.page} 頁</span>
            <FormSubmitButton
              name="page"
              value={String(result.page + 1)}
              disabled={result.page >= result.totalPages}
              pendingChildren="載入中…"
              pendingMessage="正在載入下一頁名單。"
              className={secondaryButtonClass}
            >
              下一頁
            </FormSubmitButton>
          </nav>
        ) : null}
      </Card>
    </form>
  );
}
