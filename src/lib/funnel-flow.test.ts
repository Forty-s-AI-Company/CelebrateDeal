import { describe, expect, it } from "vitest";

import {
  addFunnelStep,
  createFunnelFlow,
  deserializeFunnelFlow,
  duplicateFunnelStep,
  getFunnelSecondaryTabs,
  getFunnelStepCatalog,
  moveFunnelStep,
  parseFunnelFlow,
  removeFunnelStep,
  renameFunnelStep,
  serializeFunnelFlow,
  setFunnelStepPath,
  setFunnelStepTemplate,
  funnelStepGroupsAddableForGoal,
  isFunnelStepTypeAddableForGoal,
  stepsAddedOutsideGoal,
  type FunnelFlow,
  type FunnelGoal,
} from "@/lib/funnel-flow";

function flow(goal: "audience" | "sell" | "custom" = "custom"): FunnelFlow {
  return createFunnelFlow({ id: `flow_${goal}`, name: "秋季活動", goal, domain: "autumn-campaign" })!;
}

describe("Funnel flow v1", () => {
  it("依實測 goal 建立 Audience、Sell、Custom 預設步驟，並建立固定場次 Webinar", () => {
    expect(flow("audience").steps.map((step) => step.type)).toEqual(["opt_in_page", "opt_in_thank_you_page", "inactive_page"]);
    expect(flow("sell").steps.map((step) => step.type)).toEqual(["order_form", "thank_you_page", "inactive_page"]);
    expect(flow("custom").steps.map((step) => step.type)).toEqual(["inactive_page"]);
    expect(createFunnelFlow({ id: "webinar_flow", name: "Webinar", goal: "webinar", domain: "evergreen" })?.steps.map((step) => step.type)).toEqual(["webinar_registration_page", "webinar_thank_you_page", "webinar_broadcast_page", "inactive_page"]);
  });

  it("提供分群 step type catalog，並將 Webinar 與停用頁顯示為不可安全新增", () => {
    const catalog = getFunnelStepCatalog();
    expect(catalog.find((item) => item.type === "order_form")).toMatchObject({ group: "sales", capability: { status: "available" } });
    expect(catalog.find((item) => item.type === "opt_in_page")).toMatchObject({ group: "audience" });
    expect(catalog.find((item) => item.type === "info_page")).toMatchObject({ group: "general" });
    expect(catalog.find((item) => item.type === "webinar_registration_page")?.capability.status).toBe("available");
    expect(catalog.find((item) => item.type === "inactive_page")?.capability.status).toBe("disabled");
  });

  it("新增、重新命名與修改 path 都維持不可變資料與唯一 URL Path", () => {
    const before = flow();
    const added = addFunnelStep(before, { id: "info_1", name: "活動資訊", path: "event-info", type: "info_page" });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.flow.steps.map((step) => step.id)).toEqual(["info_1", "inactive"]);
    expect(before.steps).toHaveLength(1);
    const renamed = renameFunnelStep(added.flow, "info_1", "  活動　資訊頁 ");
    expect(renamed.ok && renamed.flow.steps[0]?.name).toBe("活動 資訊頁");
    const path = setFunnelStepPath(renamed.flow, "info_1", "/event-details/");
    expect(path.ok && path.flow.steps[0]?.path).toBe("event-details");
    expect(addFunnelStep(path.flow, { name: "重複", path: "event-details", type: "contact_us_page" }).ok).toBe(false);
  });

  it("複製、移動與移除只修改一般步驟，停用頁永遠維持最後且不可移除", () => {
    const first = addFunnelStep(flow(), { id: "info_1", name: "活動資訊", path: "event-info", type: "info_page" });
    if (!first.ok) throw new Error(first.error);
    const copy = duplicateFunnelStep(first.flow, "info_1", { id: "info_2", name: "活動資訊副本", path: "event-info-copy" });
    if (!copy.ok) throw new Error(copy.error);
    expect(copy.flow.steps.map((step) => step.id)).toEqual(["info_1", "info_2", "inactive"]);
    const moved = moveFunnelStep(copy.flow, "info_2", 0);
    expect(moved.ok && moved.flow.steps.map((step) => step.id)).toEqual(["info_2", "info_1", "inactive"]);
    expect(moveFunnelStep(moved.flow, "info_2", 2).ok).toBe(false);
    expect(removeFunnelStep(moved.flow, "inactive").ok).toBe(false);
    const removed = removeFunnelStep(moved.flow, "info_1");
    expect(removed.ok && removed.flow.steps.map((step) => step.id)).toEqual(["info_2", "inactive"]);
  });

  it("所有次要分頁連接管理功能，不依模板選擇鎖定", () => {
    const tabs = getFunnelSecondaryTabs(flow("audience"));
    expect(tabs).toHaveLength(8);
    expect(tabs.every((tab) => tab.capability.status === "available")).toBe(true);
    expect(tabs.map((tab) => tab.label)).toContain("A/B Test");
    expect(tabs.every((tab) => tab.emptyState === undefined)).toBe(true);
  });

  it("strict parse 與 serialize/deserialize round-trip 拒絕重複、遺失或未驗證資料", () => {
    const original = setFunnelStepTemplate(flow("sell"), "order_form", "checkout-basic");
    if (!original.ok) throw new Error(original.error);
    const restored = deserializeFunnelFlow(serializeFunnelFlow(original.flow));
    expect(restored).toEqual(original.flow);
    expect(parseFunnelFlow({ ...original.flow, steps: [...original.flow.steps, original.flow.steps[0]] })).toBeNull();
    expect(deserializeFunnelFlow("{")).toBeNull();
    expect(parseFunnelFlow({ ...original.flow, goal: "webinar", webinar: { timezone: "invalid" } })).toBeNull();
    expect(() => serializeFunnelFlow({ ...original.flow, domain: "not/a/path" })).toThrow();
  });

  it("建立名單網站只能新增名單與資訊步驟；其他目標維持原本可新增的群組", () => {
    const groups = (goal: FunnelGoal) => [...funnelStepGroupsAddableForGoal(goal)].sort();
    expect(groups("audience")).toEqual(["audience", "general"]);
    expect(groups("sell")).toEqual(["audience", "general", "sales"]);
    expect(groups("custom")).toEqual(["audience", "general", "sales"]);
    expect(groups("webinar")).toEqual(["audience", "general", "sales", "webinar"]);
    expect(isFunnelStepTypeAddableForGoal("audience", "thank_you_page")).toBe(false);
    expect(isFunnelStepTypeAddableForGoal("audience", "opt_in_thank_you_page")).toBe(true);
    expect(isFunnelStepTypeAddableForGoal("sell", "inactive_page")).toBe(false);

    const audience = flow("audience");
    for (const type of ["sales_page", "order_form", "upsell", "downsell", "thank_you_page"] as const) {
      const result = addFunnelStep(audience, { name: "銷售", path: `sale-${type.replace(/_/gu, "-")}`, type });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toContain("建立名單網站只能新增名單或資訊步驟");
    }
    expect(addFunnelStep(audience, { name: "Webinar", path: "webinar", type: "webinar_registration_page" }).ok).toBe(false);
    expect(addFunnelStep(audience, { name: "資訊", path: "info", type: "info_page" }).ok).toBe(true);
    expect(addFunnelStep(audience, { name: "彈出", path: "popup", type: "popup_form" }).ok).toBe(true);
    expect(addFunnelStep(flow("sell"), { name: "加購", path: "upsell", type: "upsell" }).ok).toBe(true);
  });

  it("既有的名單網站若已含銷售步驟仍可讀取，但不能再複製出新的銷售步驟", () => {
    const sell = flow("sell");
    const relabelled = parseFunnelFlow({ ...sell, goal: "audience" });
    expect(relabelled?.steps.map((step) => step.type)).toEqual(["order_form", "thank_you_page", "inactive_page"]);
    const copy = duplicateFunnelStep(relabelled!, "thank_you", { name: "感謝頁副本", path: "thank-you-copy" });
    expect(copy.ok).toBe(false);
    expect(duplicateFunnelStep(flow("audience"), "opt_in", { name: "名單頁副本", path: "opt-in-copy" }).ok).toBe(true);
  });

  it("整份儲存只拒絕這次新加入、且目標不接受的步驟", () => {
    const audience = flow("audience");
    const withSale = { ...audience, steps: [{ ...audience.steps[0]!, id: "sale", path: "sale", type: "sales_page" as const }, ...audience.steps] };
    expect(stepsAddedOutsideGoal(audience, withSale).map((step) => step.id)).toEqual(["sale"]);
    expect(stepsAddedOutsideGoal(null, withSale).map((step) => step.id)).toEqual(["sale"]);
    // Already saved: kept.
    expect(stepsAddedOutsideGoal(withSale, withSale)).toEqual([]);
    // Same id, new type: counts as added.
    const retyped = { ...audience, steps: audience.steps.map((step) => step.id === "opt_in" ? { ...step, type: "order_form" as const } : step) };
    expect(stepsAddedOutsideGoal(audience, retyped).map((step) => step.id)).toEqual(["opt_in"]);
    expect(stepsAddedOutsideGoal(null, flow("sell"))).toEqual([]);
  });
});
