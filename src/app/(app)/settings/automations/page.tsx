import { createAutomationRecipeAction, createAutomationRuleAction, deleteAutomationRuleAction, dryRunAutomationRuleAction, toggleAutomationRuleAction } from "@/app/actions/automation-actions";
import { ConfirmActionButton } from "@/components/confirm-action-button";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, Field, PageHeader, SelectField, SubmitButton, TextArea } from "@/components/ui";
import {
  AUTOMATION_BUTTON_URL_ERROR_MESSAGE,
  AUTOMATION_TRIGGER_LABELS,
  AVAILABLE_AUTOMATION_RECIPES,
  AVAILABLE_AUTOMATION_TRIGGERS,
  automationExecutionNotes,
  automationTriggerNeedsThreshold,
  isAvailableAutomationTrigger,
  maskAutomationTarget,
} from "@/lib/automation-workflow";
import { requireVendorManagerMember } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatTwd } from "@/lib/format";

const PATH = "/settings/automations";
const ACTIONS: Record<string, string> = { line_push: "LINE 推播", send_email_notification: "Email 通知", add_customer_tag: "客戶打標", issue_repurchase_voucher: "派發回購券" };
const ERROR_MESSAGES: Record<string, string> = {
  trigger_unavailable: "這個觸發條件目前不會執行，不能用來建立或啟用規則。",
  delete_requires_inactive: "請先停用規則，再刪除。",
  delete_has_history: "這條規則已有執行紀錄，為保留紀錄與已發出的標籤、折價券，只能停用、不能刪除。",
  delete_conflict: "規則剛被其他人變更，沒有刪除。請重新整理後再試。",
  not_found: "找不到這條規則，或你沒有管理權限。",
};
const UNAVAILABLE_TRIGGER_NOTE = "此觸發條件目前不會執行：系統尚未接上這個事件，規則不會被觸發。可以停用或刪除，但不能重新啟用。";

function triggerLabel(trigger: string) {
  return (AUTOMATION_TRIGGER_LABELS as Record<string, string>)[trigger] ?? trigger;
}
function actionLabels(value: unknown) { return Array.isArray(value) ? value.map((item) => ACTIONS[String((item as { type?: unknown }).type)] ?? "未知動作") : ["規則資料異常"]; }
function conditionLabel(value: unknown) {
  const condition = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (condition.type === "always") return "事件發生時";
  if (condition.type === "order_amount_gte") return `訂單滿 ${formatTwd(Number(condition.amountCents ?? 0))}`;
  if (condition.type === "watch_seconds_gte_and_not_purchased") return `觀看滿 ${condition.seconds} 秒且尚未購買`;
  return `觀看滿 ${condition.seconds ?? "?"} 秒`;
}
function errorMessage(code: string) {
  if (code === "invalid_button_url") return `規則無法建立：${AUTOMATION_BUTTON_URL_ERROR_MESSAGE}`;
  return ERROR_MESSAGES[code] ?? `規則無法更新（${code}）。`;
}
function dryRunMessage(status: string) {
  if (status === "would_dispatch") return "條件符合，正式事件會執行動作。";
  if (status === "would_skip") return "條件未符合，正式事件會略過。";
  if (status === "trigger_unavailable") return "這條規則的觸發條件目前不會執行，正式事件不會發生。";
  return "規則無效。";
}

export default async function AutomationSettingsPage({ searchParams }: { searchParams: Promise<{ updated?: string; error?: string; dryRun?: string }> }) {
  const params = await searchParams;
  const { vendor } = await requireVendorManagerMember(PATH);
  const db = getDb();
  const [products, rules, logs] = await Promise.all([
    db.product.findMany({ where: { vendorId: vendor.id, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.automationRule.findMany({ where: { vendorId: vendor.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { _count: { select: { executionLogs: true } } } }),
    db.automationExecutionLog.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" }, take: 50, include: { rule: { select: { name: true } } } }),
  ]);
  // The threshold field only matters for amount/watch triggers; it returns
  // with them (payment_paid in the next F-4 PR).
  const showThreshold = AVAILABLE_AUTOMATION_TRIGGERS.some((trigger) => automationTriggerNeedsThreshold(trigger));
  return <>
    <PageHeader title="自動化" description="把報名、直播、諮詢與訂單串成跨管道行銷流程。商家 owner 與管理員可以管理。" />
    {params.updated ? <p role="status" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">自動化規則已更新。</p> : null}
    {params.dryRun ? <p role="status" className="mb-4 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800">模擬結果：{dryRunMessage(params.dryRun)}</p> : null}
    {params.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(params.error)}</p> : null}

    <Card className="mb-6"><h2 className="text-lg font-semibold text-slate-950">熱門劇本一鍵套用</h2><p className="mb-4 text-sm text-slate-600">需要派券的劇本請先選商品。</p><div className="grid gap-4 lg:grid-cols-2">{AVAILABLE_AUTOMATION_RECIPES.map((recipe) => <form action={createAutomationRecipeAction} key={recipe.id} className="grid gap-3 rounded-xl border border-border p-4"><CsrfField /><input type="hidden" name="recipeId" value={recipe.id} /><div><h3 className="font-semibold text-slate-900">{recipe.name}</h3><p className="mt-1 text-sm text-slate-600">{recipe.description}</p></div><p className="text-xs font-medium text-slate-500">{triggerLabel(recipe.trigger)} → {actionLabels(recipe.actions).join(" + ")}</p>{recipe.actions.some((action) => action.type === "issue_repurchase_voucher") ? <SelectField label="套券商品" name="productId"><option value="">請選擇商品</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</SelectField> : null}<SubmitButton pendingChildren="套用中…">一鍵套用劇本</SubmitButton></form>)}</div></Card>

    <Card className="mb-6"><h2 className="mb-4 text-lg font-semibold text-slate-950">自訂規則</h2><form action={createAutomationRuleAction} className="grid gap-4"><CsrfField /><div className="grid gap-4 md:grid-cols-2"><Field label="規則名稱" name="name" required maxLength={120} /><SelectField label="觸發事件" name="trigger" defaultValue={AVAILABLE_AUTOMATION_TRIGGERS[0]}>{AVAILABLE_AUTOMATION_TRIGGERS.map((value) => <option key={value} value={value}>{triggerLabel(value)}</option>)}</SelectField></div>{showThreshold ? <Field label="條件門檻（付款金額元／觀看秒數；事件型觸發可留空）" name="conditionValue" type="number" min={1} step={1} /> : null}<div className="grid gap-4 rounded-md border border-border p-4"><p className="font-semibold text-slate-800">動作（至少選一項）</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="actionLine" /> LINE 推播</label><TextArea label="LINE 推播訊息" name="lineMessage" rows={3} maxLength={1500} placeholder="支援 voucher、consultation、webinar 安全網址佔位符" /><div className="grid gap-4 md:grid-cols-2"><Field label="按鈕文字" name="buttonLabel" maxLength={40} /><Field label="按鈕網址（HTTPS 或安全佔位符）" name="buttonUrl" maxLength={2000} /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="actionEmail" /> Email 通知</label><SelectField label="Email 範本" name="emailTemplate" defaultValue="consultation_confirmation"><option value="consultation_confirmation">諮詢預約確認</option><option value="class_reminder">課前提醒</option><option value="repurchase_followup">追購通知</option><option value="webinar_replay">缺席回放與諮詢邀請</option></SelectField><p className="text-xs text-slate-500">自動化寄出的 Email 都附退訂連結；已退訂或在本商家黑名單中的收件人不會收到。</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="actionVoucher" /> 發送回購券</label><div className="grid gap-4 md:grid-cols-4"><SelectField label="商品" name="productId"><option value="">請選擇商品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectField><SelectField label="折扣類型" name="discountType" defaultValue="fixed"><option value="fixed">固定金額（元）</option><option value="percentage">百分比</option></SelectField><Field label="折扣值" name="discountValue" type="number" min={1} step={1} /><Field label="效期（天）" name="expiresInDays" type="number" min={1} max={365} defaultValue={30} /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="actionTag" /> 加上客戶標籤</label><Field label="客戶標籤" name="customerTag" maxLength={50} /></div><SubmitButton pendingChildren="建立中…">建立規則</SubmitButton></form></Card>

    <Card className="mb-6"><h2 className="mb-4 text-lg font-semibold text-slate-950">視覺化規則</h2><div className="grid gap-4">{rules.length ? rules.map((rule) => {
      const available = isAvailableAutomationTrigger(rule.trigger);
      const hasHistory = rule._count.executionLogs > 0;
      return <article key={rule.id} className="grid gap-3 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{rule.name}</h3><p className="text-xs text-slate-500">{rule.createdAt.toLocaleString("zh-TW")}</p></div><div className="flex flex-wrap gap-2">{available ? null : <Badge tone="gray">目前不會執行</Badge>}<Badge tone={rule.isActive ? "green" : "gray"}>{rule.isActive ? "啟用中" : "已停用"}</Badge></div></div>
        <div className="flex flex-wrap items-center gap-2 text-sm"><span className="rounded-md bg-slate-100 px-3 py-2">觸發：{triggerLabel(rule.trigger)}</span><span>→</span><span className="rounded-md bg-amber-50 px-3 py-2">條件：{conditionLabel(rule.condition)}</span><span>→</span><span className="rounded-md bg-emerald-50 px-3 py-2">動作：{actionLabels(rule.actions).join(" + ")}</span></div>
        {available ? null : <p className="rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-slate-700">{UNAVAILABLE_TRIGGER_NOTE}</p>}
        <div className="flex flex-wrap items-end gap-3">
          {rule.isActive || available ? <form action={toggleAutomationRuleAction}><CsrfField /><input type="hidden" name="ruleId" value={rule.id} /><SubmitButton pendingChildren="更新中…">{rule.isActive ? "停用" : "啟用"}</SubmitButton></form> : null}
          {available ? <form action={dryRunAutomationRuleAction} className="flex flex-wrap items-end gap-2"><CsrfField /><input type="hidden" name="ruleId" value={rule.id} /><Field label="模擬訂單（元）" name="orderAmount" type="number" min={0} defaultValue={30000} /><Field label="模擬觀看（秒）" name="watchSeconds" type="number" min={0} defaultValue={1800} /><label className="mb-2 flex items-center gap-2 text-xs"><input type="checkbox" name="hasPurchased" /> 已購買</label><SubmitButton pendingChildren="測試中…">Dry-run 測試</SubmitButton></form> : null}
          {!rule.isActive && !hasHistory ? <form action={deleteAutomationRuleAction}><CsrfField /><input type="hidden" name="ruleId" value={rule.id} /><ConfirmActionButton type="submit" message={`確定刪除規則「${rule.name}」？`} description="刪除後無法復原。" confirmLabel="刪除" destructive className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">刪除規則</ConfirmActionButton></form> : null}
        </div>
        {rule.isActive ? <p className="text-xs text-slate-500">停用後才能刪除。</p> : hasHistory ? <p className="text-xs text-slate-500">已有執行紀錄，保留供查詢，只能停用、不能刪除。</p> : null}
      </article>;
    }) : <p className="text-sm text-slate-600">尚未建立規則。</p>}</div></Card>

    <Card><h2 className="mb-4 text-lg font-semibold text-slate-950">執行日誌（最近 50 筆）</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border text-slate-500"><th className="p-2">觸發時間</th><th className="p-2">規則</th><th className="p-2">事件</th><th className="p-2">目標（已遮罩）</th><th className="p-2">狀態</th><th className="p-2">錯誤代碼</th><th className="p-2">說明</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id} className="border-b border-border"><td className="p-2">{log.createdAt.toLocaleString("zh-TW")}</td><td className="p-2">{log.rule.name}</td><td className="p-2">{triggerLabel(log.trigger)}</td><td className="p-2 font-mono text-xs">{maskAutomationTarget(log.subjectKeyHash)}</td><td className="p-2"><Badge tone={log.status === "completed" ? "green" : log.status === "failed" ? "red" : "gray"}>{log.status}</Badge></td><td className="p-2">{log.errorCode ?? "—"}</td><td className="p-2 text-xs text-slate-600">{automationExecutionNotes(log.actionResults).join("；") || "—"}</td></tr>)}</tbody></table>{!logs.length ? <p className="py-4 text-sm text-slate-600">尚無執行紀錄。</p> : null}</div></Card>
  </>;
}
