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
  type FunnelFlow,
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
});
