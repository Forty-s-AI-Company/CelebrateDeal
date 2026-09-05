import { createAutomationRuleAction, toggleAutomationRuleAction } from "@/app/actions/automation-actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, Field, PageHeader, SelectField, SubmitButton, TextArea } from "@/components/ui";
import { requireVendorOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function AutomationSettingsPage({ searchParams }: { searchParams: Promise<{ updated?: string; error?: string }> }) {
  const params = await searchParams;
  const auth = await requireVendorOwner();
  const db = getDb();
  const [products, rules, logs] = await Promise.all([
    db.product.findMany({ where: { vendorId: auth.vendor.id, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.automationRule.findMany({ where: { vendorId: auth.vendor.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    db.automationExecutionLog.findMany({ where: { vendorId: auth.vendor.id }, orderBy: { createdAt: "desc" }, take: 50, include: { rule: { select: { name: true } } } }),
  ]);
  return <>
    <PageHeader title="自動化規則" description="依付款或觀看進度觸發 LINE 推播、回購券與客戶標籤。只有商家 owner 可以管理。" />
    {params.updated ? <p role="status" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">自動化規則已更新。</p> : null}
    {params.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">規則資料不完整或無法更新，請檢查後再試。</p> : null}
    <Card className="mb-6"><h2 className="mb-4 text-lg font-semibold text-slate-950">新增規則</h2>
      <form action={createAutomationRuleAction} className="grid gap-4">
        <CsrfField /><div className="grid gap-4 md:grid-cols-2"><Field label="規則名稱" name="name" required maxLength={120} /><SelectField label="觸發事件" name="trigger" defaultValue="payment_paid"><option value="payment_paid">付款完成</option><option value="viewer_watch_progress">觀看進度</option></SelectField></div>
        <Field label="條件門檻（付款金額元／觀看秒數）" name="conditionValue" type="number" required min={1} step={1} />
        <div className="grid gap-4 rounded-md border border-border p-4"><p className="font-semibold text-slate-800">動作（至少選一項）</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="actionLine" /> LINE 推播</label><TextArea label="LINE 推播訊息" name="lineMessage" rows={3} maxLength={1500} placeholder="可使用 {{voucher_url}}" />
          <div className="grid gap-4 md:grid-cols-2"><Field label="按鈕文字（選填）" name="buttonLabel" maxLength={40} /><Field label="按鈕網址（HTTPS 或 {{voucher_url}}）" name="buttonUrl" maxLength={2000} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="actionVoucher" /> 發送回購券</label><div className="grid gap-4 md:grid-cols-4"><SelectField label="商品" name="productId"><option value="">請選擇商品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectField><SelectField label="折扣類型" name="discountType" defaultValue="fixed"><option value="fixed">固定金額（元）</option><option value="percentage">百分比</option></SelectField><Field label="折扣值" name="discountValue" type="number" min={1} step={1} /><Field label="效期（天）" name="expiresInDays" type="number" min={1} max={365} defaultValue={30} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="actionTag" /> 加上客戶標籤</label><Field label="客戶標籤" name="customerTag" maxLength={50} />
        </div><SubmitButton pendingChildren="建立中…">建立規則</SubmitButton>
      </form>
    </Card>
    <Card className="mb-6"><h2 className="mb-4 text-lg font-semibold text-slate-950">規則清單</h2><div className="grid gap-3">{rules.length ? rules.map((rule) => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"><div><p className="font-semibold text-slate-900">{rule.name}</p><p className="text-xs text-slate-500">{rule.trigger} · {rule.createdAt.toLocaleString("zh-TW")}</p></div><div className="flex items-center gap-3"><Badge tone={rule.isActive ? "green" : "gray"}>{rule.isActive ? "啟用中" : "已停用"}</Badge><form action={toggleAutomationRuleAction}><CsrfField /><input type="hidden" name="ruleId" value={rule.id} /><SubmitButton pendingChildren="更新中…">{rule.isActive ? "停用" : "啟用"}</SubmitButton></form></div></div>) : <p className="text-sm text-slate-600">尚未建立規則。</p>}</div></Card>
    <Card><h2 className="mb-4 text-lg font-semibold text-slate-950">執行日誌（最近 50 筆）</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border text-slate-500"><th className="p-2">時間</th><th className="p-2">規則</th><th className="p-2">觸發</th><th className="p-2">狀態</th><th className="p-2">錯誤</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id} className="border-b border-border"><td className="p-2">{log.createdAt.toLocaleString("zh-TW")}</td><td className="p-2">{log.rule.name}</td><td className="p-2">{log.trigger}</td><td className="p-2"><Badge tone={log.status === "completed" ? "green" : log.status === "failed" ? "red" : "gray"}>{log.status}</Badge></td><td className="p-2">{log.errorCode ?? "—"}</td></tr>)}</tbody></table>{!logs.length ? <p className="py-4 text-sm text-slate-600">尚無執行紀錄。</p> : null}</div></Card>
  </>;
}
