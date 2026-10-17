import { resolvePaymentStatus, type PaymentWebhookEventType } from "@/lib/payment-webhook-invariants";
import { describe, expect, it } from "vitest";
import { FUNNEL_GOALS, FUNNEL_STEP_TYPES } from "@/lib/funnel-flow";
import { funnelGoalLabels, funnelStepLabels, funnelTabLabels, experimentStatusLabels, experimentArmLabels, reportStatusLabel, referenceOptions } from "./funnel-display-labels";

describe("merchant display terminology", () => {
  it("covers every persisted goal and step type without changing its key", () => {
    expect(Object.keys(funnelGoalLabels)).toEqual([...FUNNEL_GOALS]);
    expect(Object.keys(funnelStepLabels)).toEqual([...FUNNEL_STEP_TYPES]);
    for (const key of FUNNEL_STEP_TYPES) {
      expect(funnelStepLabels[key]).toMatch(/[\u4e00-\u9fff]/u);
      expect(funnelStepLabels[key]).not.toBe(key);
    }
  });
  it("keeps the approved display dictionary reviewable", () => {
    expect({ funnelGoalLabels, funnelStepLabels, funnelTabLabels, experimentStatusLabels, experimentArmLabels }).toMatchSnapshot();
  });
});

it("never labels an unknown or inherited status as successful", () => {
  expect(reportStatusLabel("paid", "payment")).toBe("已付款");
  expect(reportStatusLabel("VERIFIED", "verification")).toBe("已驗證");
  for (const domain of ["order", "payment", "verification"] as const) {
    for (const status of ["new_future_state", "__proto__", "constructor", "toString"]) expect(reportStatusLabel(status, domain)).toBe("未知狀態");
  }
});

it("preserves reference values while naming duplicate and unnamed options", () => {
  const ids = ["internal_a", "internal_b", "internal_c", "constructor"];
  const names = { internal_a: "報名頁", internal_b: "報名頁" };
  const options = referenceOptions(ids, names, "步驟");
  expect(options.map((item) => item.value)).toEqual(ids);
  expect(options.map((item) => item.label)).toEqual(["報名頁（第 1 項）", "報名頁（第 2 項）", "未命名步驟 3", "未命名步驟 4"]);
  expect(referenceOptions(["popup_internal"], { popup_internal: "活動提醒" }, "彈出視窗")).toEqual([{ value: "popup_internal", label: "活動提醒" }]);
  expect(names).toEqual({ internal_a: "報名頁", internal_b: "報名頁" });
});

it("distinguishes visually identical reference names without mutating source values", () => {
  const names = { a: "報名頁", b: " 報名頁 ", c: "   " };
  expect(referenceOptions(["a", "b", "c"], names, "步驟")).toEqual([
    { value: "a", label: "報名頁（第 1 項）" },
    { value: "b", label: "報名頁（第 2 項）" },
    { value: "c", label: "未命名步驟 3" },
  ]);
  expect(names).toEqual({ a: "報名頁", b: " 報名頁 ", c: "   " });
});

it("labels the transaction writer event results and checkout states", () => {
  const events = { paid: "已付款", refunded: "已退款", partially_refunded: "部分退款", failed: "付款失敗", dispute_opened: "付款爭議處理中", dispute_released: "付款爭議已解除", dispute_lost: "付款爭議敗訴" } satisfies Record<PaymentWebhookEventType, string>;
  for (const event of Object.keys(events) as PaymentWebhookEventType[]) {
    expect(reportStatusLabel(resolvePaymentStatus(null, event), "payment")).toBe(events[event]);
    expect(reportStatusLabel(resolvePaymentStatus("pending", event), "payment")).toBe(events[event]);
  }
  expect(reportStatusLabel("pending", "payment")).toBe("待付款");
  expect(reportStatusLabel("expired", "payment")).toBe(reportStatusLabel("expired", "order"));
  expect(reportStatusLabel("cancelled", "payment")).toBe("已取消");
});

it("keeps final option labels distinct when authored names resemble generated suffixes", () => {
  const ids = ["a", "b", "c", "d"];
  const names = { a: "報名頁（第 2 項）", b: "報名頁", c: "報名頁", d: "報名頁\u200b" };
  const original = { ...names };
  for (const kind of ["步驟", "彈出視窗"] as const) {
    const options = referenceOptions(ids, names, kind);
    expect(new Set(options.map((option) => option.label)).size).toBe(ids.length);
    expect(options.map((option) => option.value)).toEqual(ids);
  }
  expect(names).toEqual(original);
});

it("snapshots every report status display label", () => {
  const domains = {
    order: ["draft", "pending_payment", "paid", "payment_failed", "expired", "cancelled", "partially_refunded", "refunded"],
    verification: ["UNVERIFIED", "VERIFIED"],
    payment: ["pending", "paid", "failed", "refunded", "partially_refunded", "cancelled", "expired", "dispute_opened", "dispute_released", "dispute_lost"],
  };
  expect(Object.fromEntries((Object.keys(domains) as (keyof typeof domains)[]).map((domain) => [domain,
    Object.fromEntries(domains[domain].map((status) => [status, reportStatusLabel(status, domain)])),
  ]))).toMatchSnapshot();
});
