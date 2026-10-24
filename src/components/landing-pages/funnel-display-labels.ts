import type { PaymentWebhookEventType } from "@/lib/payment-webhook-invariants";
import type { FormSubmissionVerificationStatus } from "@prisma/client";
import type { CommerceOrderStatus } from "@/lib/commerce-order-domain";
import type { FunnelExperiment } from "@/lib/funnel-operations";
import { FUNNEL_STEP_GROUPS, getFunnelStepCatalog, isFunnelStepTypeAddableForGoal, type FunnelGoal, type FunnelStepGroup, type FunnelStepType } from "@/lib/funnel-flow";

// 僅顯示層對照；儲存、路由與 API 使用原本的識別值。
export const funnelTabKeys = ["Configuration", "Automation Rules", "A/B test", "Stats", "Leads", "Sales", "Deadline settings"] as const;
export const funnelTabLabels = {
  Configuration: "頁面設定", "Automation Rules": "自動化規則", "A/B test": "A/B 測試",
  Stats: "成效統計", Leads: "報名名單", Sales: "銷售紀錄", "Deadline settings": "截止設定",
} satisfies Record<typeof funnelTabKeys[number], string>;
export const funnelGoalLabels = {
  audience: "建立名單", sell: "銷售商品", custom: "自訂流程", webinar: "線上講座",
} satisfies Record<FunnelGoal, string>;
export const funnelStepLabels = {
  sales_page: "銷售頁", order_form: "訂單表單", upsell: "加購頁", downsell: "降價加購頁", thank_you_page: "感謝頁",
  opt_in_page: "名單頁", opt_in_thank_you_page: "名單感謝頁", inline_form: "內嵌表單", popup_form: "彈出表單", link_in_bio: "個人簡介連結頁",
  info_page: "資訊頁", contact_us_page: "聯絡我們", webinar_registration_page: "線上講座報名頁",
  webinar_thank_you_page: "線上講座感謝頁", webinar_broadcast_page: "線上講座播放頁", inactive_page: "停用頁",
} satisfies Record<FunnelStepType, string>;
const funnelStepGroupLabels = { sales: "銷售", audience: "名單", general: "資訊", webinar: "線上講座", system: "系統" } satisfies Record<FunnelStepGroup, string>;
type AddableStepType = Exclude<FunnelStepType, "inactive_page">;

/** 新增步驟選單：依步驟目錄的群組，只列出這個網站目標可新增的類型（伺服器端套用同一規則）。 */
export function addableStepTypeOptions(goal: FunnelGoal): Array<{ group: FunnelStepGroup; label: string; items: Array<{ value: AddableStepType; label: string }> }> {
  const catalog = getFunnelStepCatalog().filter((step) => isFunnelStepTypeAddableForGoal(goal, step.type));
  return FUNNEL_STEP_GROUPS.flatMap((group) => {
    const items = catalog.filter((step) => step.group === group).map((step) => ({ value: step.type as AddableStepType, label: funnelStepLabels[step.type] }));
    return items.length ? [{ group, label: funnelStepGroupLabels[group], items }] : [];
  });
}

export const experimentStatusLabels = { draft: "草稿", running: "進行中", stopped: "已停止", winner: "已選定勝出組別" } satisfies Record<FunnelExperiment["status"], string>;
export const experimentArmLabels = { control: "對照組", variant: "測試組" } satisfies Record<NonNullable<FunnelExperiment["winner"]>, string>;

const verificationStatusLabels = { UNVERIFIED: "尚未驗證", VERIFIED: "已驗證" } satisfies Record<FormSubmissionVerificationStatus, string>;
const orderStatusLabels = {
  draft: "草稿", pending_payment: "待付款", paid: "已付款", payment_failed: "付款失敗", expired: "付款逾期",
  cancelled: "已取消", partially_refunded: "部分退款", refunded: "已退款",
} satisfies Record<CommerceOrderStatus, string>;
// 交易狀態目前是後端字串欄位；遇到未支援值明示未知，不推測為成功。
const paymentStatusLabels = { pending: "待付款", paid: "已付款", failed: "付款失敗", refunded: "已退款", partially_refunded: "部分退款", cancelled: "已取消", expired: "付款逾期", dispute_opened: "付款爭議處理中", dispute_released: "付款爭議已解除", dispute_lost: "付款爭議敗訴" } satisfies Record<PaymentWebhookEventType | "pending" | "cancelled" | "expired", string>;
export function reportStatusLabel(value: string, domain: "order" | "verification" | "payment"): string {
  const labels: Readonly<Record<string, string>> = domain === "order" ? orderStatusLabels : domain === "verification" ? verificationStatusLabels : paymentStatusLabels;
  return Object.hasOwn(labels, value) ? labels[value] ?? "未知狀態" : "未知狀態";
}

/** 下拉選單顯示名稱；value 保留原識別值，重名與未命名項目仍可區分。 */
export function referenceOptions(ids: readonly string[], names: Readonly<Record<string, string>> | undefined, kind: "步驟" | "彈出視窗") {
  const labels = ids.map((id, index) => {
    const name = names && Object.hasOwn(names, id) ? (names[id] ?? "").replace(/[\u200b\ufeff]/gu, "").trim() : "";
    return name || `未命名${kind} ${index + 1}`;
  });
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  const options = ids.map((value, index) => { const label = labels[index] ?? ""; return { value, label: (counts.get(label) ?? 0) > 1 ? `${label}（第 ${index + 1} 項）` : label }; });
  // 自訂名稱也可能包含系統後綴；整組加上唯一位置前綴，避免再次碰撞。
  return new Set(options.map((option) => option.label)).size === options.length
    ? options
    : options.map((option, index) => ({ ...option, label: `${index + 1}. ${option.label}` }));
}
