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
import { AutomationEmailTemplateSelect } from "@/components/automation-email-template-select";
import { AutomationStepDelayFields } from "@/components/automation-step-delay-fields";
import { ConfirmActionButton } from "@/components/confirm-action-button";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, Field, PageHeader, SelectField, SubmitButton, TextArea } from "@/components/ui";
import {
  AUTOMATION_BUTTON_URL_ERROR_MESSAGE,
  AUTOMATION_TRIGGER_LABELS,
  AVAILABLE_AUTOMATION_RECIPES,
  AUTOMATION_DELAYED_STEPS_FEATURE,
  availableAutomationTriggersForVendor,
  FORM_NO_SHOW_DETECTION_NOTE,
  WATCH_DURATION_DETECTION_NOTE,
  WATCH_DURATION_MINUTE_OPTIONS,
  WATCH_PROGRESS_DETECTION_NOTE,
  WATCH_PROGRESS_PERCENT_OPTIONS,
  automationEmailTemplateAdvice,
  automationExecutionNotes,
  automationTriggerNeedsThreshold,
  automationTriggerSupportsDelayedSteps,
  isAutomationRuleRunnableForVendor,
  isAutomationStepExecution,
  isAutomationTriggerAvailableForVendor,
  maskAutomationTarget,
} from "@/lib/automation-workflow";
import { automationRuleRunCounts, MAX_AUTOMATION_RULE_STEPS } from "@/lib/automation-delayed-steps";
import {
  automationActionsIncludeLinePush,
  automationActionsSendLine,
  automationRuleIncludesLinePush,
  automationRuleSendsLine,
  LINE_PUSH_OWNER_ONLY,
  LINE_PUSH_OWNER_ONLY_MESSAGE,
  mayConfigureAutomationLinePush,
  VOUCHER_LINE_NOTIFICATION_FIELD,
  VOUCHER_LINE_NOTIFICATION_OWNER_ONLY_MESSAGE,
} from "@/lib/automation-line-push-policy";
import { requireVendorManagerMember } from "@/lib/auth";
import { isFeatureEnabled } from "@/lib/vendor-feature-toggles";
import { getDb } from "@/lib/db";
import { formatTwd } from "@/lib/format";

const PATH = "/settings/automations";
/** A form_no_show rule of a vendor without the closed-beta grant (Q-11 review M-1). */
const FORM_NO_SHOW_NOT_GRANTED_NOTE = "「報名後未出席直播」目前是封測功能，尚未對你的商家開放，這條規則不會執行。你可以停用或刪除它。";
/** A viewer_watch_progress rule of a vendor without the closed-beta grant (Q-11). */
const WATCH_PROGRESS_NOT_GRANTED_NOTE = "「觀看直播達到指定進度」目前是封測功能，尚未對你的商家開放，這條規則不會執行。你可以停用或刪除它。";
/** A viewer_watch_progress rule saved with the old watch-seconds condition, before the trigger was connected (Q-11). */
const WATCH_PROGRESS_LEGACY_CONDITION_NOTE = "這條規則用的是舊的「觀看秒數」條件，不會執行，也不能重新啟用。請刪除它，改用觀看進度百分比建立新規則。";
/** What the create form says about viewer_watch_progress (Q-11). */
const WATCH_PROGRESS_FORM_NOTE = "「觀看直播達到指定進度」在報名者的觀看進度達到門檻後約 5 分鐘內執行，每位報名者、每條規則一次（重新整理、換裝置都不會重複；同一個 Email 用不同表單報名同一場直播也只執行一次）；只對規則建立或啟用之後仍在觀看的人執行。";
/** A webinar_attended_duration_gte rule of a vendor without the closed-beta grant (Q-11). */
const WATCH_DURATION_NOT_GRANTED_NOTE = "「觀看直播累計達指定時間」目前是封測功能，尚未對你的商家開放，這條規則不會執行。你可以停用或刪除它。";
/** A webinar_attended_duration_gte rule saved with the old watch-seconds condition, before the trigger was connected (Q-11). */
const WATCH_DURATION_LEGACY_CONDITION_NOTE = "這條規則用的是舊的「觀看秒數」條件，不會執行，也不能重新啟用。請刪除它，改用觀看分鐘數建立新規則。";
/** What the create form says about webinar_attended_duration_gte (Q-11). */
const WATCH_DURATION_FORM_NOTE = "「觀看直播累計達指定時間」在報名者的累計觀看時間達到門檻後約 5 分鐘內執行（每輪處理的名額有限，同時達到門檻的人多時可能延後幾輪才執行），每位報名者、每條規則一次（重新整理、換裝置都不會重複；同一個 Email 用不同表單報名同一場直播也只執行一次）；只對規則建立或啟用之後仍在觀看的人執行。";
const NOT_GRANTED_NOTES: Record<string, string> = {
  form_no_show: FORM_NO_SHOW_NOT_GRANTED_NOTE,
  viewer_watch_progress: WATCH_PROGRESS_NOT_GRANTED_NOTE,
  webinar_attended_duration_gte: WATCH_DURATION_NOT_GRANTED_NOTE,
};
/** How the watch time is counted, shown on every runnable rule of a watch trigger (Q-11). */
const WATCH_DETECTION_NOTES: Record<string, string | undefined> = {
  viewer_watch_progress: WATCH_PROGRESS_DETECTION_NOTE,
  webinar_attended_duration_gte: WATCH_DURATION_DETECTION_NOTE,
};
/** #651 review NIT-2: each watch trigger's note on the create form in its own paragraph, under its name. */
function WatchTriggerFormNote({ trigger, note }: { trigger: string; note: string }) {
  return <p className="text-sm text-slate-600" data-trigger-note={trigger}><span className="font-semibold text-slate-800">{triggerLabel(trigger)}：</span>{note}</p>;
}
/** The dry-run's simulated watch value, in the unit of the rule's threshold. */
function DryRunWatchField({ trigger }: { trigger: string }) {
  if (trigger === "viewer_watch_progress") return <Field label="模擬觀看進度（%）" name="watchPercent" type="number" min={0} max={100} defaultValue={50} />;
  if (trigger === "webinar_attended_duration_gte") return <Field label="模擬累計觀看（分鐘）" name="watchMinutes" type="number" min={0} defaultValue={30} />;
  return <Field label="模擬觀看（秒）" name="watchSeconds" type="number" min={0} defaultValue={1800} />;
}
function notRunnableNote(rule: { trigger: string }, available: boolean) {
  if (!available) return NOT_GRANTED_NOTES[rule.trigger] ?? UNAVAILABLE_TRIGGER_NOTE;
  return rule.trigger === "webinar_attended_duration_gte" ? WATCH_DURATION_LEGACY_CONDITION_NOTE : WATCH_PROGRESS_LEGACY_CONDITION_NOTE;
}
const ACTIONS: Record<string, string> = { line_push: "LINE 推播", send_email_notification: "Email 通知", add_customer_tag: "客戶打標", issue_repurchase_voucher: "派發回購券" };
const ERROR_MESSAGES: Record<string, string> = {
  trigger_unavailable: "這個觸發條件目前不會執行，不能用來建立或啟用規則。",
  steps_unsupported: "這個觸發條件的規則只能設定立即執行的動作，不能加延遲步驟。",
  delete_requires_inactive: "請先停用規則，再刪除。",
  delete_has_history: "這條規則已有執行紀錄，為保留紀錄與已發出的標籤、折價券，只能停用、不能刪除。",
  not_found: "找不到這條規則或步驟，或你沒有管理權限。",
  toggle_conflict: "規則剛被其他人變更，請重新整理後再試。",
  delete_busy: "規則正在執行，請稍後再試。",
  no_action: "請至少選一個動作。",
  invalid_delay: `延遲時間請填 1 小時到 90 天之間的整數。`,
  duplicate_delay: "同一條規則已經有這個延遲時間的步驟，請換一個時間。",
  step_limit: `每條規則最多 ${MAX_AUTOMATION_RULE_STEPS} 個延遲步驟。`,
  invalid_email_content: "自訂 Email 的主旨或內文不符規則：主旨必填、限 100 字、不能換行；內文必填、限 2000 字；只能使用這個觸發條件提供的變數。",
  email_template_unavailable: "這個 Email 範本在所選的觸發條件下沒有可用的連結，不能使用。請改選清單中的範本；「追購通知」需要同時勾選「發送回購券」。",
  invalid_step: "步驟內容不完整或格式不正確，請檢查動作欄位。",
  invalid_product: "找不到這個商品，或商品已下架。",
  step_busy: "規則正在被其他人修改或執行，請稍後再試。",
  toggle_busy: "規則正在被其他人修改或執行，請稍後再試。",
  condition_unsupported: "這條規則的條件是舊格式，不會執行，不能重新啟用。請刪除後重新建立。",
  [LINE_PUSH_OWNER_ONLY]: "LINE 推播與派券的 LINE 通知僅限擁有者設定。會發 LINE 訊息的規則，管理員只能停用、刪除規則或刪除步驟。",
};
/**
 * How a buyer still gets a voucher sent without a LINE notification, shown to
 * a non-owner next to the voucher fields and on voucher recipes.
 */
const VOUCHER_WITHOUT_LINE_NOTE = `${VOUCHER_LINE_NOTIFICATION_OWNER_ONLY_MESSAGE}你設定的派券不會用 LINE 通知買家：買家可在學員專區的「專屬優惠券」看到這張券（限可在本平台結帳的商品）；要主動通知，請同時勾選 Email 通知並選「追購通知」範本，信中會附領券連結。`;
/**
 * Shown to a non-owner on a rule that sends LINE: a custom LINE push, or
 * (owner decision 2026-11-15) a voucher with its LINE notification on.
 * `stepsShown`: the delayed-step section is on the page (beta grant and a
 * trigger that takes steps, or a hidden one whose steps can still be
 * deleted). A LINE push is named first; the note says whether what sends LINE
 * is in a delayed step only; when both the immediate actions and a step send
 * LINE, the note names both.
 */
function lineRuleNote({ stepsShown, rule }: { stepsShown: boolean; rule: { actions: unknown; steps: Array<{ actions: unknown }> } }) {
  const push = automationRuleIncludesLinePush(rule);
  const inStepsOnly = push ? !automationActionsIncludeLinePush(rule.actions) : !automationActionsSendLine(rule.actions);
  const what = push ? "含 LINE 推播" : "派券時會用 LINE 通知買家";
  const both = automationActionsSendLine(rule.actions) && rule.steps.some((step) => automationActionsSendLine(step.actions));
  const where = both
    ? `這條規則和它的延遲步驟都會發 LINE 訊息（LINE 推播或派券通知）${stepsShown ? "" : "，延遲步驟目前不在此頁顯示"}。`
    : inStepsOnly
    ? stepsShown ? `這條規則的延遲步驟${what}。` : `這條規則的延遲步驟${what}（延遲步驟目前不在此頁顯示）。`
    : `這條規則${what}。`;
  const allowed = stepsShown
    ? "你可以停用、刪除規則或刪除步驟，但不能啟用、新增或修改步驟。"
    : "你可以停用或刪除規則，但不能啟用。";
  return `${where}${push ? LINE_PUSH_OWNER_ONLY_MESSAGE : VOUCHER_LINE_NOTIFICATION_OWNER_ONLY_MESSAGE}${allowed}`;
}
const UPDATED_MESSAGES: Record<string, string> = {
  step_created: "延遲步驟已新增。",
  step_updated: "延遲步驟已更新。",
  step_deleted: "延遲步驟已刪除。",
};
const UNAVAILABLE_TRIGGER_NOTE = "此觸發條件目前不會執行：系統尚未接上這個事件，規則不會被觸發。可以停用或刪除，但不能重新啟用。";
const NO_DELAYED_STEPS_NOTE = "這個觸發條件的規則只有立即執行的動作，不能加延遲步驟。";
/**
 * Q-09 review NIT-4: who a rule's delayed-step e-mail reaches, by trigger.
 * payment_paid says nothing here: PAYMENT_PAID_STEPS_NOTE, right below,
 * states its rule.
 */
function stepsEmailNote(trigger: string) {
  if (trigger === "payment_paid") return "";
  if (trigger === "consultation_booked" || trigger === "consultation_no_show") return "Email 只寄給在你這裡用同一個 Email 完成報名驗證的預約者。";
  return "Email 只寄給已驗證的報名者。";
}
/**
 * Q-09: what a payment_paid rule's delayed steps do differently: they stop
 * once the order is fully refunded or cancelled (a partial refund goes on),
 * and the buyer's e-mail address counts as confirmed only with a verified
 * registration or a student-portal sign-in at this vendor.
 */
const PAYMENT_PAID_STEPS_NOTE = "「訂單付款完成」的延遲步驟從付款完成後規則第一次執行的時間起算。訂單全額退款或取消後不再執行（部分退款仍會繼續）。付款不代表買家確認過 Email，所以延遲步驟的 Email 只寄給在你這裡用同一個 Email 完成報名驗證，或登入過學員專區的買家；其他買家的 Email 會略過，貼標籤、派券與 LINE 照常執行。";

function triggerLabel(trigger: string) {
  return (AUTOMATION_TRIGGER_LABELS as Record<string, string>)[trigger] ?? trigger;
}
function actionLabel(item: unknown) {
  const type = String((item as { type?: unknown } | null)?.type);
  // A voucher stored with its LINE notification off (an admin's, or the owner unticked it).
  if (type === "issue_repurchase_voucher" && (item as Record<string, unknown>)[VOUCHER_LINE_NOTIFICATION_FIELD] === false) return "派發回購券（不發 LINE 通知）";
  return ACTIONS[type] ?? "未知動作";
}
function actionLabels(value: unknown) { return Array.isArray(value) ? value.map(actionLabel) : ["規則資料異常"]; }
function conditionLabel(value: unknown) {
  const condition = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (condition.type === "always") return "事件發生時";
  if (condition.type === "order_amount_gte") return `訂單滿 ${formatTwd(Number(condition.amountCents ?? 0))}`;
  if (condition.type === "watch_percent_gte") return `觀看進度達 ${condition.percent ?? "?"}%`;
  if (condition.type === "watch_minutes_gte") return `累計觀看滿 ${condition.minutes ?? "?"} 分鐘`;
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

/**
 * Q-18: advice on a stored rule (or one of its steps) whose e-mail template has
 * no link on its trigger. Only a hint; the rule keeps running as it was.
 */
function emailTemplateNotes(rule: { trigger: string; actions: unknown; steps: Array<{ actions: unknown }> }) {
  return [...new Set([
    ...automationEmailTemplateAdvice(rule.trigger, rule.actions).map((note) => `立即動作：${note}`),
    ...rule.steps.flatMap((step) => automationEmailTemplateAdvice(rule.trigger, step.actions).map((note) => `延遲步驟：${note}`)),
  ])];
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
 * Without `linePushAllowed` (not the owner) the LINE push fields and the
 * voucher's LINE notification checkbox are left out; the Server Actions refuse
 * a LINE push from a non-owner and save a non-owner's voucher without the
 * LINE notification anyway. The owner's checkbox starts ticked for a new
 * voucher and shows the stored flag otherwise (missing = on).
 */
function ActionFields({ products, actions, linePushAllowed, trigger, triggerFieldName }: { products: Array<{ id: string; name: string }>; actions?: unknown; linePushAllowed: boolean; trigger: string; triggerFieldName?: string }) {
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
    <AutomationEmailTemplateSelect trigger={trigger} triggerFieldName={triggerFieldName} hasVoucher={Boolean(voucher)} defaultTemplate={typeof email?.template === "string" ? email.template : null} defaultSubject={typeof email?.subject === "string" ? email.subject : null} defaultBody={typeof email?.body === "string" ? email.body : null} keepTemplate={typeof email?.template === "string" ? email.template : null} />
    <p className="text-xs text-slate-500">自動化寄出的 Email 都附退訂連結；已退訂或在本商家黑名單中的收件人不會收到。</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="actionVoucher" defaultChecked={Boolean(voucher)} /> 發送回購券</label>
    <div className="grid gap-4 md:grid-cols-4">
      <SelectField label="商品" name="productId" defaultValue={typeof voucher?.productId === "string" ? voucher.productId : ""}><option value="">請選擇商品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectField>
      <SelectField label="折扣類型" name="discountType" defaultValue={voucherFixed ? "fixed" : "percentage"}><option value="fixed">固定金額（元）</option><option value="percentage">百分比</option></SelectField>
      <Field label="折扣值" name="discountValue" type="number" min={1} step={1} defaultValue={voucherValue} />
      <Field label="效期（天）" name="expiresInDays" type="number" min={1} max={365} defaultValue={typeof voucher?.expiresInDays === "number" ? voucher.expiresInDays : 30} />
    </div>
    {linePushAllowed ? <div className="grid gap-1">
      <input type="hidden" name="voucherLineNotificationShown" value="1" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="voucherLineNotification" defaultChecked={voucher ? voucher[VOUCHER_LINE_NOTIFICATION_FIELD] !== false : true} /> 同時用 LINE 通知買家領券</label>
      <p className="text-xs text-slate-500">以平台固定文案（附「立即使用」按鈕）透過你的 LINE 官方帳號，通知已綁定 LINE 的買家。同一條規則或同一步已勾選 LINE 推播時，不會另外再發這則通知。</p>
    </div> : <p className="text-xs text-slate-500">{VOUCHER_WITHOUT_LINE_NOTE}</p>}
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
  rule: { id: string; name: string; trigger: string; steps: RuleStep[] };
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
    <p className="text-xs text-slate-600">從事件發生的時間起算，到點時重新讀取對象再執行。job 停擺超過 24 小時的步驟會跳過；同一個人同一步最多執行一次，改延遲時間也不會重複執行。{stepsEmailNote(rule.trigger)}</p>
    {rule.trigger === "payment_paid" ? <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">{PAYMENT_PAID_STEPS_NOTE}</p> : null}
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
              <ActionFields products={products} actions={step.actions} linePushAllowed={linePushAllowed} trigger={rule.trigger} />
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
        <ActionFields products={products} linePushAllowed={linePushAllowed} trigger={rule.trigger} />
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
  // form_no_show is a closed beta (Q-11 review M-1): without the grant it is
  // neither offered nor run.
  const triggers = availableAutomationTriggersForVendor(vendor);
  const recipes = AVAILABLE_AUTOMATION_RECIPES.filter((recipe) => isAutomationTriggerAvailableForVendor(recipe.trigger, vendor));
  const formNoShow = triggers.includes("form_no_show");
  // viewer_watch_progress is a closed beta too (Q-11): offered only with its grant.
  const watchProgress = triggers.includes("viewer_watch_progress");
  // ... and so is webinar_attended_duration_gte (Q-11), with its own grant.
  const watchDuration = triggers.includes("webinar_attended_duration_gte");
  // The amount field only matters for payment_paid (F-4 PR 3); the watch
  // percent and the watch minutes have their own fields below.
  const showThreshold = triggers.some((trigger) => trigger !== "viewer_watch_progress" && trigger !== "webinar_attended_duration_gte" && automationTriggerNeedsThreshold(trigger));
  return <>
    <PageHeader title="自動化" description={linePushAllowed ? "把報名、直播、諮詢與訂單串成跨管道行銷流程。商家 owner 與管理員可以管理。" : `把報名、直播、諮詢與訂單串成跨管道行銷流程。商家 owner 與管理員可以管理；${LINE_PUSH_OWNER_ONLY_MESSAGE}`} />
    {params.updated ? <p role="status" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{UPDATED_MESSAGES[params.updated] ?? "自動化規則已更新。"}</p> : null}
    {params.dryRun ? <p role="status" className="mb-4 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800">模擬結果：{dryRunMessage(params.dryRun)}</p> : null}
    {params.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(params.error)}</p> : null}

    <Card className="mb-6"><h2 className="text-lg font-semibold text-slate-950">熱門劇本一鍵套用</h2><p className="mb-4 text-sm text-slate-600">需要派券的劇本請先選商品。</p><div className="grid gap-4 lg:grid-cols-2">{recipes.map((recipe) => <form action={createAutomationRecipeAction} key={recipe.id} className="grid gap-3 rounded-xl border border-border p-4"><CsrfField /><input type="hidden" name="recipeId" value={recipe.id} /><div><h3 className="font-semibold text-slate-900">{recipe.name}</h3><p className="mt-1 text-sm text-slate-600">{recipe.description}</p></div>{recipe.trigger === "form_no_show" ? <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">{FORM_NO_SHOW_DETECTION_NOTE}</p> : null}<p className="text-xs font-medium text-slate-500">{triggerLabel(recipe.trigger)} → {actionLabels(recipe.actions).join(" + ")}</p>{!linePushAllowed && automationActionsIncludeLinePush(recipe.actions) ? <p className="text-xs text-slate-600">這個劇本含 LINE 推播。{LINE_PUSH_OWNER_ONLY_MESSAGE}</p> : <>{!linePushAllowed && recipe.actions.some((action) => action.type === "issue_repurchase_voucher") ? <p className="text-xs text-slate-600">{VOUCHER_WITHOUT_LINE_NOTE}</p> : null}{recipe.actions.some((action) => action.type === "issue_repurchase_voucher") ? <SelectField label="套券商品" name="productId"><option value="">請選擇商品</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</SelectField> : null}<SubmitButton pendingChildren="套用中…">一鍵套用劇本</SubmitButton></>}</form>)}</div></Card>

    <Card className="mb-6"><h2 className="mb-4 text-lg font-semibold text-slate-950">自訂規則</h2><form action={createAutomationRuleAction} className="grid gap-4" aria-label="建立自訂規則"><CsrfField /><div className="grid gap-4 md:grid-cols-2"><Field label="規則名稱" name="name" required maxLength={120} /><SelectField label="觸發事件" name="trigger" defaultValue={triggers[0]}>{triggers.map((value) => <option key={value} value={value}>{triggerLabel(value)}</option>)}</SelectField></div>{showThreshold ? <Field label="付款金額門檻（元；只用於「訂單付款完成」，其他觸發條件留空）" name="conditionValue" type="number" min={1} step={1} /> : null}{watchProgress ? <SelectField label="觀看進度門檻（只用於「觀看直播達到指定進度」）" name="watchPercent" defaultValue="50">{WATCH_PROGRESS_PERCENT_OPTIONS.map((percent) => <option key={percent} value={percent}>{percent}%</option>)}</SelectField> : null}{watchDuration ? <SelectField label="累計觀看時間門檻（只用於「觀看直播累計達指定時間」）" name="watchMinutes" defaultValue="15">{WATCH_DURATION_MINUTE_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} 分鐘</option>)}</SelectField> : null}<p className="text-sm text-slate-600">以下是事件發生時「立即執行」的動作{delayedSteps ? "；建立後可在規則下方加上延遲步驟（例如 1 天後再寄一封）" : ""}。「訂單付款完成」在付款確認後執行一次，金額以訂單實際付款金額判斷，Email 寄給訂單的買家。{formNoShow ? `「報名後未出席直播」在場次結束約 30 分鐘後，對已完成 Email 驗證、卻沒有用完成驗證的瀏覽器或個人觀看連結進入觀看（含回放）的報名者執行，每人每個場次一次，只對規則建立或啟用之後才結束的場次執行；單一開播時間的直播只算開播前 14 天內完成驗證的報名者。${FORM_NO_SHOW_DETECTION_NOTE}` : ""}</p>{watchProgress ? <WatchTriggerFormNote trigger="viewer_watch_progress" note={`${WATCH_PROGRESS_FORM_NOTE}${WATCH_PROGRESS_DETECTION_NOTE}`} /> : null}{watchDuration ? <WatchTriggerFormNote trigger="webinar_attended_duration_gte" note={`${WATCH_DURATION_FORM_NOTE}${WATCH_DURATION_DETECTION_NOTE}`} /> : null}<ActionFields products={products} linePushAllowed={linePushAllowed} trigger={triggers[0] ?? "form_registered"} triggerFieldName="trigger" /><SubmitButton pendingChildren="建立中…">建立規則</SubmitButton></form></Card>

    <Card className="mb-6"><h2 className="mb-4 text-lg font-semibold text-slate-950">規則</h2><div className="grid gap-4">{rules.length ? rules.map((rule) => {
      const available = isAutomationTriggerAvailableForVendor(rule.trigger, vendor);
      // Q-11: an available viewer_watch_progress or webinar_attended_duration_gte rule with the old watch-seconds condition still never runs.
      const runnable = available && isAutomationRuleRunnableForVendor(rule, vendor);
      const hasHistory = rule._count.executionLogs > 0;
      // A rule that sends LINE (a custom LINE push or a voucher's LINE
      // notification, immediate or any step) is read-only for a non-owner
      // except switching off and deleting; the actions refuse the rest.
      const linePushOwnerOnly = !linePushAllowed && automationRuleSendsLine(rule);
      // The delayed-step section shows for a trigger that takes steps, or a hidden one (its steps can still be deleted).
      const stepsShown = delayedSteps && (automationTriggerSupportsDelayedSteps(rule.trigger) || !available);
      return <article key={rule.id} aria-label={rule.name} className="grid gap-3 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{rule.name}</h3><p className="text-xs text-slate-500">{rule.createdAt.toLocaleString("zh-TW")}</p></div><div className="flex flex-wrap gap-2">{runnable ? null : <Badge tone="gray">目前不會執行</Badge>}{linePushOwnerOnly ? <Badge tone="gray">僅限擁有者修改</Badge> : null}<Badge tone={rule.isActive ? "green" : "gray"}>{rule.isActive ? "啟用中" : "已停用"}</Badge></div></div>
        <div className="flex flex-wrap items-center gap-2 text-sm"><span className="rounded-md bg-slate-100 px-3 py-2">觸發：{triggerLabel(rule.trigger)}</span><span>→</span><span className="rounded-md bg-amber-50 px-3 py-2">條件：{conditionLabel(rule.condition)}</span><span>→</span><span className="rounded-md bg-emerald-50 px-3 py-2">立即執行：{actionLabels(rule.actions).join(" + ")}</span></div>
        {runnable ? null : <p className="rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-slate-700">{notRunnableNote(rule, available)}</p>}
        {runnable ? emailTemplateNotes(rule).map((note) => <p key={note} className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>) : null}
        {rule.trigger === "form_no_show" ? <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{FORM_NO_SHOW_DETECTION_NOTE}</p> : null}
        {runnable && WATCH_DETECTION_NOTES[rule.trigger] ? <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{WATCH_DETECTION_NOTES[rule.trigger]}</p> : null}
        {linePushOwnerOnly ? <p className="rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-slate-700">{lineRuleNote({ stepsShown, rule })}</p> : null}
        {delayedSteps ? (stepsShown
          ? <RuleSteps rule={rule} editable={runnable && !linePushOwnerOnly} linePushAllowed={linePushAllowed} products={products} counts={runCounts.get(rule.id)} />
          : <p className="rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-slate-700">{NO_DELAYED_STEPS_NOTE}</p>) : null}
        <div className="flex flex-wrap items-end gap-3">
          {rule.isActive || (runnable && !linePushOwnerOnly) ? <form action={toggleAutomationRuleAction}><CsrfField /><input type="hidden" name="ruleId" value={rule.id} /><SubmitButton pendingChildren="更新中…">{rule.isActive ? "停用" : "啟用"}</SubmitButton></form> : null}
          {runnable ? <form action={dryRunAutomationRuleAction} className="flex flex-wrap items-end gap-2"><CsrfField /><input type="hidden" name="ruleId" value={rule.id} /><Field label="模擬訂單（元）" name="orderAmount" type="number" min={0} defaultValue={30000} /><DryRunWatchField trigger={rule.trigger} /><label className="mb-2 flex items-center gap-2 text-xs"><input type="checkbox" name="hasPurchased" /> 已購買</label><SubmitButton pendingChildren="測試中…">Dry-run 測試</SubmitButton></form> : null}
          {!rule.isActive && !hasHistory ? <form action={deleteAutomationRuleAction}><CsrfField /><input type="hidden" name="ruleId" value={rule.id} /><ConfirmActionButton type="submit" message={`確定刪除規則「${rule.name}」？`} description="刪除後無法復原。" confirmLabel="刪除" destructive className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">刪除規則</ConfirmActionButton></form> : null}
        </div>
        {rule.isActive ? <p className="text-xs text-slate-500">停用後才能刪除。{delayedSteps ? "停用時，進行中的延遲步驟會立即停止，重新啟用也不會恢復。" : ""}</p> : hasHistory ? <p className="text-xs text-slate-500">已有執行紀錄，保留供查詢，只能停用、不能刪除。</p> : null}
      </article>;
    }) : <p className="text-sm text-slate-600">尚未建立規則。</p>}</div></Card>

    <Card><h2 className="mb-4 text-lg font-semibold text-slate-950">執行日誌（最近 50 筆）</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border text-slate-500"><th className="p-2">觸發時間</th><th className="p-2">規則</th><th className="p-2">事件</th><th className="p-2">目標（已遮罩）</th><th className="p-2">狀態</th><th className="p-2">錯誤代碼</th><th className="p-2">說明</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id} className="border-b border-border"><td className="p-2">{log.createdAt.toLocaleString("zh-TW")}</td><td className="p-2">{log.rule.name}</td><td className="p-2">{triggerLabel(log.trigger)}{isAutomationStepExecution(log) ? "（延遲步驟）" : ""}</td><td className="p-2 font-mono text-xs">{maskAutomationTarget(log.subjectKeyHash)}</td><td className="p-2"><Badge tone={log.status === "completed" ? "green" : log.status === "failed" ? "red" : "gray"}>{log.status}</Badge></td><td className="p-2">{log.errorCode ?? "—"}</td><td className="p-2 text-xs text-slate-600">{automationExecutionNotes(log.actionResults).join("；") || "—"}</td></tr>)}</tbody></table>{!logs.length ? <p className="py-4 text-sm text-slate-600">尚無執行紀錄。</p> : null}</div></Card>
  </>;
}
