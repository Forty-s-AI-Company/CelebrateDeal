"use client";

import { startTransition, useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createFunnelAutomationRuleAction,
  listFunnelAutomationRulesAction,
  setFunnelAutomationRuleEnabledAction,
  updateFunnelAutomationRuleAction,
  type FunnelAutomationActionState,
} from "@/app/actions/funnel-automation-actions";
import type { FunnelAutomationRule } from "@/lib/funnel-automation-service";

const control = "min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:opacity-50";

/**
 * Page-local rules only support the safe MVP path: a verified form
 * registration receives one customer tag. Rules are loaded on demand so this
 * editor does not expose any other tenant's automation configuration.
 */
export function FunnelAutomationSettings({ pageId, csrfName, csrfToken }: { pageId: string; csrfName: string; csrfToken: string }) {
  const [rules, setRules] = useState<FunnelAutomationRule[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reloadEpoch, setReloadEpoch] = useState(0);

  const payload = useCallback(() => {
    const formData = new FormData();
    formData.set("pageId", pageId);
    formData.set(csrfName, csrfToken);
    return formData;
  }, [csrfName, csrfToken, pageId]);

  const apply = useCallback((result: FunnelAutomationActionState) => {
    if (result.rules) setRules(result.rules);
    if (result.status === "error") {
      setError(result.message);
      setNotice("");
      return;
    }
    setError("");
    setNotice(result.message);
  }, []);

  const reload = useCallback((resetInputs = false) => {
    setLoading(true);
    startTransition(async () => {
      try {
        const result = await listFunnelAutomationRulesAction(payload());
        startTransition(() => {
          apply(result);
          // Inputs deliberately use defaultValue so mutations do not discard
          // edits in other rules. A user-requested refresh is the one moment
          // where server values should replace every local draft.
          if (resetInputs && result.status === "success") setReloadEpoch((value) => value + 1);
        });
      } catch {
        startTransition(() => setError("規則清單暫時無法載入，請再試一次。"));
      } finally {
        setLoading(false);
      }
    });
  }, [apply, payload]);

  useEffect(() => {
    // Defer the initial fetch until after this render commits. This avoids a
    // synchronous state update while React is installing the effect.
    const timer = window.setTimeout(reload, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const submit = (event: FormEvent<HTMLFormElement>, action: (formData: FormData) => Promise<FunnelAutomationActionState>) => {
    event.preventDefault();
    // The first self-load is itself a Server Action. Do not enqueue a mutation
    // until it has finished, otherwise the browser can hold two Flight actions
    // for this editor at once.
    if (loading || submitting) return;
    setSubmitting(true);
    const formData = new FormData(event.currentTarget);
    formData.set("pageId", pageId);
    formData.set(csrfName, csrfToken);
    startTransition(async () => {
      try {
        const result = await action(formData);
        startTransition(() => apply(result));
      } catch {
        startTransition(() => setError("規則暫時無法儲存；請檢查網路後再試。"));
      } finally {
        setSubmitting(false);
      }
    });
  };

  return <section aria-labelledby="funnel-automation-title" className="grid gap-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="funnel-automation-title" className="font-bold text-violet-950">報名後自動化</h2><p className="mt-1 text-xs leading-5 text-violet-900">已成功提交表單的訪客會自動加上客戶標籤。規則只會套用到這個漏斗。</p></div>
      <button type="button" className={control} disabled={loading || submitting} onClick={() => void reload(true)}>重新載入</button>
    </div>
    {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    {notice ? <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p> : null}
    <form className="grid gap-3 rounded-lg border border-violet-200 bg-white p-3" onSubmit={(event) => void submit(event, createFunnelAutomationRuleAction)}>
      <input type="hidden" name={csrfName} value={csrfToken} /><input type="hidden" name="pageId" value={pageId} />
      <p className="text-sm font-semibold text-slate-900">新增規則</p>
      <label className="grid gap-1 text-xs font-semibold text-slate-700">規則名稱<input required maxLength={120} name="name" className={control} placeholder="例如：九月講座報名名單" disabled={loading || submitting} /></label>
      <label className="grid gap-1 text-xs font-semibold text-slate-700">客戶標籤<input required maxLength={50} name="tag" className={control} placeholder="例如：九月講座已報名" disabled={loading || submitting} /></label>
      <button type="submit" disabled={loading || submitting} className="min-h-10 rounded-lg bg-violet-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{submitting ? "儲存中…" : "建立標籤規則"}</button>
    </form>
    <div className="grid gap-3" aria-busy={loading}>
      {loading ? <p className="text-sm text-slate-600">載入規則中…</p> : null}
      {!loading && !rules.length ? <p className="text-sm text-slate-600">這個漏斗尚未建立報名後自動化。</p> : null}
      {rules.map((rule) => <article key={`${rule.id}:${reloadEpoch}`} className="grid gap-3 rounded-lg border border-violet-200 bg-white p-3">
        <form className="grid gap-3" onSubmit={(event) => void submit(event, updateFunnelAutomationRuleAction)}>
          <input type="hidden" name={csrfName} value={csrfToken} /><input type="hidden" name="pageId" value={pageId} /><input type="hidden" name="ruleId" value={rule.id} /><input type="hidden" name="version" value={rule.version} />
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-900">報名完成 → 加上標籤</p><span className={rule.isActive ? "rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800" : "rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700"}>{rule.isActive ? "啟用中" : "已停用"}</span></div>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">規則名稱<input required maxLength={120} name="name" className={control} defaultValue={rule.name} disabled={loading || submitting} /></label>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">客戶標籤<input required maxLength={50} name="tag" className={control} defaultValue={rule.tag} disabled={loading || submitting} /></label>
          <button type="submit" disabled={loading || submitting} className="min-h-10 rounded-lg border border-violet-300 px-4 text-sm font-semibold text-violet-900 disabled:opacity-50">儲存變更</button>
        </form>
        <form onSubmit={(event) => void submit(event, setFunnelAutomationRuleEnabledAction)}>
          <input type="hidden" name={csrfName} value={csrfToken} /><input type="hidden" name="pageId" value={pageId} /><input type="hidden" name="ruleId" value={rule.id} /><input type="hidden" name="version" value={rule.version} /><input type="hidden" name="isActive" value={String(!rule.isActive)} />
          <button type="submit" disabled={loading || submitting} className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800 disabled:opacity-50">{rule.isActive ? "停用規則" : "啟用規則"}</button>
        </form>
      </article>)}
    </div>
  </section>;
}
