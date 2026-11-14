import {
  createAutomationRecipeAction,
  createAutomationRuleAction,
  createAutomationRuleStepAction,
  deleteAutomationRuleAction,
  deleteAutomationRuleStepAction,
  dryRunAutomationRuleAction,
  toggleAutomationRuleAction,
  updateAutomationRuleStepAction,
} from "@/app/actions/automation-actions";
import { AutomationStepDelayFields } from "@/components/automation-step-delay-fields";
import { ConfirmActionButton } from "@/components/confirm-action-button";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, Field, PageHeader, SelectField, SubmitButton, TextArea } from "@/components/ui";
import {
  AUTOMATION_BUTTON_URL_ERROR_MESSAGE,
  AUTOMATION_TRIGGER_LABELS,
  AVAILABLE_AUTOMATION_RECIPES,
  AVAILABLE_AUTOMATION_TRIGGERS,
  AUTOMATION_DELAYED_STEPS_FEATURE,
  automationExecutionNotes,
  automationTriggerNeedsThreshold,
  automationTriggerSupportsDelayedSteps,
  isAutomationStepExecution,
  isAvailableAutomationTrigger,
  maskAutomationTarget,
} from "@/lib/automation-workflow";
import { automationRuleRunCounts, MAX_AUTOMATION_RULE_STEPS } from "@/lib/automation-delayed-steps";
import {
  automationActionsIncludeLinePush,
  automationRuleIncludesLinePush,
  LINE_PUSH_OWNER_ONLY,
  LINE_PUSH_OWNER_ONLY_MESSAGE,
  mayConfigureAutomationLinePush,
} from "@/lib/automation-line-push-policy";
import { requireVendorManagerMember } from "@/lib/auth";
import { isFeatureEnabled } from "@/lib/vendor-feature-toggles";
import { getDb } from "@/lib/db";
import { formatTwd } from "@/lib/format";

const PATH = "/settings/automations";
const ACTIONS: Record<string, string> = { line_push: "LINE 推播", send_email_notification: "Email 通知", add_customer_tag: "客戶打標", issue_repurchase_voucher: "派發回購券" };
const ERROR_MESSAGES: Record<string, string> = {
  trigger_unavailable: "這個觸發條件目前不會執行，不能用來建立或啟用規則。",
  steps_unsupported: "「訂單付款完成」的規則目前只能設定立即執行的動作，不能加延遲步驟。",
  delete_requires_inactive: "請先停用規則，再刪除。",
  delete_has_history: "這條規則已有執行紀錄，為保留紀錄與已發出的標籤、折價券，只能停用、不能刪除。",
  not_found: "找不到這條規則或步驟，或你沒有管理權限。",
  toggle_conflict: "規則剛被其他人變更，請重新整理後再試。",
  delete_busy: "規則正在執行，請稍後再試。",
  no_action: "請至少選一個動作。",
  invalid_delay: `延遲時間請填 1 小時到 90 天之間的整數。`,
  duplicate_delay: "同一條規則已經有這個延遲時間的步驟，請換一個時間。",
  step_limit: `每條規則最多 ${MAX_AUTOMATION_RULE_STEPS} 個延遲步驟。`,
  invalid_step: "步驟內容不完整或格式不正確，請檢查動作欄位。",
  invalid_product: "找不到這個商品，或商品已下架。",
  step_busy: "規則正在被其他人修改或執行，請稍後再試。",
  toggle_busy: "規則正在被其他人修改或執行，請稍後再試。",
  [LINE_PUSH_OWNER_ONLY]: `${LINE_PUSH_OWNER_ONLY_MESSAGE}含 LINE 推播的規則，管理員只能停用、刪除規則或刪除步驟。`,
};
/** Shown to a non-owner on a rule (or recipe) that has a custom LINE push. */
function linePushRuleNote(delayedSteps: boolean) {
  return delayedSteps
    ? `這條規則含 LINE 推播。${LINE_PUSH_OWNER_ONLY_MESSAGE}你可以停用、刪除規則或刪除步驟，但不能啟用、新增或修改步驟。`
    : `這條規則含 LINE 推播。${LINE_PUSH_OWNER_ONLY_MESSAGE}你可以停用或刪除規則，但不能啟用。`;
}
const UPDATED_MESSAGES: Record<string, string> = {
  step_created: "延遲步驟已新增。",
  step_updated: "延遲步驟已更新。",
  step_deleted: "延遲步驟已刪除。",
};
const UNAVAILABLE_TRIGGER_NOTE = "此觸發條件目前不會執行：系統尚未接上這個事件，規則不會被觸發。可以停用或刪除，但不能重新啟用。";
const NO_DELAYED_STEPS_NOTE = "「訂單付款完成」的規則目前只有立即執行的動作，還不能加延遲步驟。";
const EMAIL_TEMPLATES: Array<[string, string]> = [
  ["consultation_confirmation", "諮詢預約確認"],
  ["class_reminder", "課前提醒"],
  ["repurchase_followup", "追購通知"],
  ["webinar_replay", "缺席回放與諮詢邀請"],
];

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
  if (code === "invalid_button_url") return `無法儲存：${AUTOMATION_BUTTON_URL_ERROR_MESSAGE}`;
  return ERROR_MESSAGES[code] ?? `規則無法更新（${code}）。`;
}
function dryRunMessage(status: string) {
  if (status === "would_dispatch") return "條件符合，正式事件會執行動作。";
  if (status === "would_skip") return "條件未符合，正式事件會略過。";
  if (status === "trigger_unavailable") return "這條規則的觸發條件目前不會執行，正式事件不會發生。";
  return "規則無效。";
}

/** A step's delay in the unit the form offers: whole days when it is one, otherwise hours. */
function delayParts(delayMinutes: number) {
  return delayMinutes % 1_440 === 0
    ? { value: delayMinutes / 1_440, unit: "days" as const }
    : { value: Math.round(delayMinutes / 60), unit: "hours" as const };
}
function delayLabel(delayMinutes: number) {
  const { value, unit } = delayParts(delayMinutes);
  return unit === "days" ? `事件後第 ${value} 天` : `事件後 ${value} 小時`;
}

type StoredAction = Record<string, unknown>;

function findAction(actions: unknown, type: string): StoredAction | null {
  if (!Array.isArray(actions)) return null;
  const found = actions.find((action) => Boolean(action) && typeof action === "object" && (action as StoredAction).type === type);
  return (found as StoredAction | undefined) ?? null;
}

/**
 * The action checkboxes and fields of a rule or a delayed step. Same field
 * names as the rule form, parsed by the same server code (parseActions).
 * Without `linePushAllowed` (not the owner) the LINE push fields are left out;
 * the Server Actions refuse a LINE push from a non-owner anyway.
 */
function ActionFields({ products, actions, linePushAllowed }: { products: Array<{ id: string; name: string }>; actions?: unknown; linePushAllowed: boolean }) {
  const line = findAction(actions, "line_push");
  const email = findAction(actions, "send_email_notification");
  const voucher = findAction(actions, "issue_repurchase_voucher");
  const tag = findAction(actions, "add_customer_tag");
  const voucherFixed = voucher?.discountType !== "percentage";
  const voucherValue = voucher ? Number(voucher.discountValue ?? 0) / (voucherFixed ? 100 : 1) : null;
  return <div className="grid gap-4 rounded-md border border-border p-4">
    <p className="font-semibold text-slate-800">動作（至少選一項）</p>
    {linePushAllowed ? <>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="actionLine" defaultChecked={Boolean(line)} /> LINE 推播</label>
      <TextArea label="LINE 推播訊息" name="lineMessage" rows={3} maxLength={1500} placeholder="支援 voucher、consultation、webinar 安全網址佔位符" defaultValue={typeof line?.message === "string" ? line.message : null} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="按鈕文字" name="buttonLabel" maxLength={40} defaultValue={typeof line?.buttonLabel === "string" ? line.buttonLabel : null} />
        <Field label="按鈕網址（HTTPS 或安全佔位符）" name="buttonUrl" maxLength={2000} defaultValue={typeof line?.buttonUrl === "string" ? line.buttonUrl : null} />
      </div>
    </> : <p className="text-xs text-slate-500">{LINE_PUSH_OWNER_ONLY_MESSAGE}</p>}
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="actionEmail" defaultChecked={Boolean(email)} /> Email 通知</label>
    <SelectField label="Email 範本" name="emailTemplate" defaultValue={typeof email?.template === "string" ? email.template : "consultation_confirmation"}>
      {EMAIL_TEMPLATES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </SelectField>
    <p className="text-xs text-slate-500">自動化寄出的 Email 都附退訂連結；已退訂或在本商家黑名單中的收件人不會收到。</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="actionVoucher" defaultChecked={Boolean(voucher)} /> 發送回購券</label>
    <div className="grid gap-4 md:grid-cols-4">
      <SelectField label="商品" name="productId" defaultValue={typeof voucher?.productId === "string" ? voucher.productId : ""}><option value="">請選擇商品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectField>
      <SelectField label="折扣類型" name="discountType" defaultValue={voucherFixed ? "fixed" : "percentage"}><option value="fixed">固定金額（元）</option><option value="percentage">百分比</option></SelectField>
      <Field label="折扣值" name="discountValue" type="number" min={1} step={1} defaultValue={voucherValue} />
      <Field label="效期（天）" name="expiresInDays" type="number" min={1} max={365} defaultValue={typeof voucher?.expiresInDays === "number" ? voucher.expiresInDays : 30} />
    </div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="actionTag" defaultChecked={Boolean(tag)} /> 加上客戶標籤</label>
    <Field label="客戶標籤" name="customerTag" maxLength={50} defaultValue={typeof tag?.tag === "string" ? tag.tag : null} />
  </div>;
}

function DelayFields({ delayMinutes }: { delayMinutes?: number }) {
  const parts = delayMinutes ? delayParts(delayMinutes) : { value: 1, unit: "days" as const };
  return <AutomationStepDelayFields value={parts.value} unit={parts.unit} />;
}

type RuleStep = { id: string; delayMinutes: number; actions: unknown; isActive: boolean };

/**
 * `editable`: the trigger can run and, for a non-owner, the rule has no LINE
 * push (owner decision 2026-11-14). Deleting a step stays available either way.
 */
function RuleSteps({ rule, editable, linePushAllowed, products, counts }: {
  rule: { id: string; name: string; steps: RuleStep[] };
  editable: boolean;
  linePushAllowed: boolean;
  products: Array<{ id: string; name: string }>;
  counts?: { active: number; completed: number; cancelled: number };
}) {
  const canAdd = editable && rule.steps.length < MAX_AUTOMATION_RULE_STEPS;
  return <section aria-label={`「${rule.name}」的延遲步驟`} className="grid gap-3 rounded-md border border-border bg-slate-50 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-sm font-semibold text-slate-900">延遲步驟（{rule.steps.length}／{MAX_AUTOMATION_RULE_STEPS}）</h4>
      {counts ? <p className="text-xs text-slate-600">進行中 {counts.active} 人・完成 {counts.completed} 人・停止 {counts.cancelled} 人</p> : null}
    </div>
    <p className="text-xs text-slate-600">從事件發生的時間起算，到點時重新讀取對象再執行。job 停擺超過 24 小時的步驟會跳過；同一個人同一步最多執行一次，改延遲時間也不會重複執行。Email 只寄給已驗證的報名者。</p>
    {rule.steps.length ? <ol className="grid gap-2">
      {rule.steps.map((step) => <li key={step.id} className="rounded-md border border-border bg-white p-3">
        <details>
          <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-slate-900">{delayLabel(step.delayMinutes)}</span>
            <span className="text-slate-600">{actionLabels(step.actions).join(" + ")}</span>
            <Badge tone={step.isActive ? "green" : "gray"}>{step.isActive ? "執行" : "不執行"}</Badge>
          </summary>
          <div className="mt-3 grid gap-3">
            {editable ? <form action={updateAutomationRuleStepAction} className="grid gap-4" aria-label={`編輯步驟：${delayLabel(step.delayMinutes)}`}>
              <CsrfField />
              <input type="hidden" name="ruleId" value={rule.id} />
              <input type="hidden" name="stepId" value={step.id} />
              <DelayFields delayMinutes={step.delayMinutes} />
              <ActionFields products={products} actions={step.actions} linePushAllowed={linePushAllowed} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="stepActive" defaultChecked={step.isActive} /> 執行這一步</label>
              <SubmitButton pendingChildren="儲存中…">儲存步驟</SubmitButton>
            </form> : null}
            <form action={deleteAutomationRuleStepAction}>
              <CsrfField />
              <input type="hidden" name="ruleId" value={rule.id} />
              <input type="hidden" name="stepId" value={step.id} />
              <ConfirmActionButton type="submit" message={`確定刪除「${delayLabel(step.delayMinutes)}」這一步？`} description="進行中的人會直接進到下一步；已執行過的紀錄保留。" confirmLabel="刪除" destructive className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">刪除步驟</ConfirmActionButton>
            </form>
          </div>
        </details>
      </li>)}
    </ol> : <p className="text-sm text-slate-600">尚未設定延遲步驟，只有事件發生時立即執行。</p>}
    {canAdd ? <details className="rounded-md border border-dashed border-border bg-white p-3">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-primary">新增延遲步驟</summary>
      <form action={createAutomationRuleStepAction} className="mt-3 grid gap-4" aria-label={`新增「${rule.name}」的延遲步驟`}>
        <CsrfField />
        <input type="hidden" name="ruleId" value={rule.id} />
        <DelayFields />
        <ActionFields products={products} linePushAllowed={linePushAllowed} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="stepActive" defaultChecked /> 執行這一步</label>
        <SubmitButton pendingChildren="新增中…">新增步驟</SubmitButton>
      </form>
    </details> : editable ? <p className="text-xs text-slate-500">已達每條規則 {MAX_AUTOMATION_RULE_STEPS} 個延遲步驟的上限。</p> : null}
  </section>;
}

export default async function AutomationSettingsPage({ searchParams }: { searchParams: Promise<{ updated?: string; error?: string; dryRun?: string }> }) {
  const params = await searchParams;
  const { vendor, member } = await requireVendorManagerMember(PATH);
  // Owner decision 2026-11-14: only the owner sets up or re-enables a custom LINE push.
  const linePushAllowed = mayConfigureAutomationLinePush(member.role);
  const db = getDb();
  // F-4 delayed steps are a closed-beta module (review M3).
  const delayedSteps = isFeatureEnabled(vendor, AUTOMATION_DELAYED_STEPS_FEATURE);
  const [products, rules, logs, runCounts] = await Promise.all([
    db.product.findMany({ where: { vendorId: vendor.id, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.automationRule.findMany({
      where: { vendorId: vendor.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        _count: { select: { executionLogs: true } },
        steps: { where: { vendorId: vendor.id }, orderBy: { delayMinutes: "asc" }, select: { id: true, delayMinutes: true, actions: true, isActive: true } },
      },
    }),
    db.automationExecutionLog.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" }, take: 50, include: { rule: { select: { name: true } } } }),
    delayedSteps ? automationRuleRunCounts(vendor.id, db) : Promise.resolve(new Map<string, { active: number; completed: number; cancelled: number }>()),
  ]);
  // The threshold field only matters for amount/watch triggers (today only
  // payment_paid, F-4 PR 3).
  const showThreshold = AVAILABLE_AUTOMATION_TRIGGERS.some((trigger) => automationTriggerNeedsThreshold(trigger));
  return <>
    <PageHeader title="自動化" description={linePushAllowed ? "把報名、直播、諮詢與訂單串成跨管道行銷流程。商家 owner 與管理員可以管理。" : `把報名、直播、諮詢與訂單串成跨管道行銷流程。商家 owner 與管理員可以管理；${LINE_PUSH_OWNER_ONLY_MESSAGE}`} />
    {params.updated ? <p role="status" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{UPDATED_MESSAGES[params.updated] ?? "自動化規則已更新。"}</p> : null}
    {params.dryRun ? <p role="status" className="mb-4 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800">模擬結果：{dryRunMessage(params.dryRun)}</p> : null}
    {params.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(params.error)}</p> : null}

    <Card className="mb-6"><h2 className="text-lg font-semibold text-slate-950">熱門劇本一鍵套用</h2><p className="mb-4 text-sm text-slate-600">需要派券的劇本請先選商品。</p><div className="grid gap-4 lg:grid-cols-2">{AVAILABLE_AUTOMATION_RECIPES.map((recipe) => <form action={createAutomationRecipeAction} key={recipe.id} className="grid gap-3 rounded-xl border border-border p-4"><CsrfField /><input type="hidden" name="recipeId" value={recipe.id} /><div><h3 className="font-semibold text-slate-900">{recipe.name}</h3><p className="mt-1 text-sm text-slate-600">{recipe.description}</p></div><p className="text-xs font-medium text-slate-500">{triggerLabel(recipe.trigger)} → {actionLabels(recipe.actions).join(" + ")}</p>{!linePushAllowed && automationActionsIncludeLinePush(recipe.actions) ? <p className="text-xs text-slate-600">這個劇本含 LINE 推播。{LINE_PUSH_OWNER_ONLY_MESSAGE}</p> : <>{recipe.actions.some((action) => action.type === "issue_repurchase_voucher") ? <SelectField label="套券商品" name="productId"><option value="">請選擇商品</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</SelectField> : null}<SubmitButton pendingChildren="套用中…">一鍵套用劇本</SubmitButton></>}</form>)}</div></Card>

    <Card className="mb-6"><h2 className="mb-4 text-lg font-semibold text-slate-950">自訂規則</h2><form action={createAutomationRuleAction} className="grid gap-4" aria-label="建立自訂規則"><CsrfField /><div className="grid gap-4 md:grid-cols-2"><Field label="規則名稱" name="name" required maxLength={120} /><SelectField label="觸發事件" name="trigger" defaultValue={AVAILABLE_AUTOMATION_TRIGGERS[0]}>{AVAILABLE_AUTOMATION_TRIGGERS.map((value) => <option key={value} value={value}>{triggerLabel(value)}</option>)}</SelectField></div>{showThreshold ? <Field label="付款金額門檻（元；只用於「訂單付款完成」，其他觸發條件留空）" name="conditionValue" type="number" min={1} step={1} /> : null}<p className="text-sm text-slate-600">以下是事件發生時「立即執行」的動作{delayedSteps ? "；建立後可在規則下方加上延遲步驟（例如 1 天後再寄一封，「訂單付款完成」除外）" : ""}。「訂單付款完成」在付款確認後執行一次，金額以訂單實際付款金額判斷，Email 寄給訂單的買家。</p><ActionFields products={products} linePushAllowed={linePushAllowed} /><SubmitButton pendingChildren="建立中…">建立規則</SubmitButton></form></Card>

    <Card className="mb-6"><h2 className="mb-4 text-lg font-semibold text-slate-950">規則</h2><div className="grid gap-4">{rules.length ? rules.map((rule) => {
      const available = isAvailableAutomationTrigger(rule.trigger);
      const hasHistory = rule._count.executionLogs > 0;
      // A rule with a custom LINE push (immediate or any step) is read-only for
      // a non-owner except switching off and deleting; the actions refuse the rest.
      const linePushOwnerOnly = !linePushAllowed && automationRuleIncludesLinePush(rule);
      return <article key={rule.id} aria-label={rule.name} className="grid gap-3 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{rule.name}</h3><p className="text-xs text-slate-500">{rule.createdAt.toLocaleString("zh-TW")}</p></div><div className="flex flex-wrap gap-2">{available ? null : <Badge tone="gray">目前不會執行</Badge>}{linePushOwnerOnly ? <Badge tone="gray">僅限擁有者修改</Badge> : null}<Badge tone={rule.isActive ? "green" : "gray"}>{rule.isActive ? "啟用中" : "已停用"}</Badge></div></div>
        <div className="flex flex-wrap items-center gap-2 text-sm"><span className="rounded-md bg-slate-100 px-3 py-2">觸發：{triggerLabel(rule.trigger)}</span><span>→</span><span className="rounded-md bg-amber-50 px-3 py-2">條件：{conditionLabel(rule.condition)}</span><span>→</span><span className="rounded-md bg-emerald-50 px-3 py-2">立即執行：{actionLabels(rule.actions).join(" + ")}</span></div>
        {available ? null : <p className="rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-slate-700">{UNAVAILABLE_TRIGGER_NOTE}</p>}
        {linePushOwnerOnly ? <p className="rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-slate-700">{linePushRuleNote(delayedSteps)}</p> : null}
        {delayedSteps ? (automationTriggerSupportsDelayedSteps(rule.trigger) || !available
          ? <RuleSteps rule={rule} editable={available && !linePushOwnerOnly} linePushAllowed={linePushAllowed} products={products} counts={runCounts.get(rule.id)} />
          : <p className="rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-slate-700">{NO_DELAYED_STEPS_NOTE}</p>) : null}
        <div className="flex flex-wrap items-end gap-3">
          {rule.isActive || (available && !linePushOwnerOnly) ? <form action={toggleAutomationRuleAction}><CsrfField /><input type="hidden" name="ruleId" value={rule.id} /><SubmitButton pendingChildren="更新中…">{rule.isActive ? "停用" : "啟用"}</SubmitButton></form> : null}
          {available ? <form action={dryRunAutomationRuleAction} className="flex flex-wrap items-end gap-2"><CsrfField /><input type="hidden" name="ruleId" value={rule.id} /><Field label="模擬訂單（元）" name="orderAmount" type="number" min={0} defaultValue={30000} /><Field label="模擬觀看（秒）" name="watchSeconds" type="number" min={0} defaultValue={1800} /><label className="mb-2 flex items-center gap-2 text-xs"><input type="checkbox" name="hasPurchased" /> 已購買</label><SubmitButton pendingChildren="測試中…">Dry-run 測試</SubmitButton></form> : null}
          {!rule.isActive && !hasHistory ? <form action={deleteAutomationRuleAction}><CsrfField /><input type="hidden" name="ruleId" value={rule.id} /><ConfirmActionButton type="submit" message={`確定刪除規則「${rule.name}」？`} description="刪除後無法復原。" confirmLabel="刪除" destructive className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">刪除規則</ConfirmActionButton></form> : null}
        </div>
        {rule.isActive ? <p className="text-xs text-slate-500">停用後才能刪除。{delayedSteps ? "停用時，進行中的延遲步驟會立即停止，重新啟用也不會恢復。" : ""}</p> : hasHistory ? <p className="text-xs text-slate-500">已有執行紀錄，保留供查詢，只能停用、不能刪除。</p> : null}
      </article>;
    }) : <p className="text-sm text-slate-600">尚未建立規則。</p>}</div></Card>

    <Card><h2 className="mb-4 text-lg font-semibold text-slate-950">執行日誌（最近 50 筆）</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border text-slate-500"><th className="p-2">觸發時間</th><th className="p-2">規則</th><th className="p-2">事件</th><th className="p-2">目標（已遮罩）</th><th className="p-2">狀態</th><th className="p-2">錯誤代碼</th><th className="p-2">說明</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id} className="border-b border-border"><td className="p-2">{log.createdAt.toLocaleString("zh-TW")}</td><td className="p-2">{log.rule.name}</td><td className="p-2">{triggerLabel(log.trigger)}{isAutomationStepExecution(log) ? "（延遲步驟）" : ""}</td><td className="p-2 font-mono text-xs">{maskAutomationTarget(log.subjectKeyHash)}</td><td className="p-2"><Badge tone={log.status === "completed" ? "green" : log.status === "failed" ? "red" : "gray"}>{log.status}</Badge></td><td className="p-2">{log.errorCode ?? "—"}</td><td className="p-2 text-xs text-slate-600">{automationExecutionNotes(log.actionResults).join("；") || "—"}</td></tr>)}</tbody></table>{!logs.length ? <p className="py-4 text-sm text-slate-600">尚無執行紀錄。</p> : null}</div></Card>
  </>;
}
