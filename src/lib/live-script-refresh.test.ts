import { describe, expect, it } from "vitest";
import { isLiveScriptRefreshThrottled, LIVE_SCRIPT_REFRESH_MIN_INTERVAL_MS, planLiveScriptRefresh } from "./live-script-refresh";

const existing = { id: "script-1", name: "首波促購腳本" };
const created = { id: "script-2", name: "新建腳本" };
const another = { id: "script-3", name: "另一份腳本" };

describe("isLiveScriptRefreshThrottled", () => {
  it("lets the first refresh through and holds later ones for five seconds", () => {
    expect(LIVE_SCRIPT_REFRESH_MIN_INTERVAL_MS).toBe(5_000);
    expect(isLiveScriptRefreshThrottled(null, 1_000)).toBe(false);
    expect(isLiveScriptRefreshThrottled(1_000, 1_000)).toBe(true);
    expect(isLiveScriptRefreshThrottled(1_000, 5_999)).toBe(true);
    expect(isLiveScriptRefreshThrottled(1_000, 6_000)).toBe(false);
  });

  it("does not hold a refresh after the clock moved backwards", () => {
    expect(isLiveScriptRefreshThrottled(10_000, 2_000)).toBe(false);
  });
});

describe("planLiveScriptRefresh", () => {
  const base = { known: [existing], selectedId: "", manual: false, canAutoSelect: true };

  it("selects the only new script when nothing is selected and announces it", () => {
    const plan = planLiveScriptRefresh({ ...base, fetched: [created, existing] });
    expect(plan.options.map((script) => script.id)).toEqual(["script-2", "script-1"]);
    expect(plan.autoSelectId).toBe("script-2");
    expect(plan.announcement).toContain("新建腳本");
    expect(plan.announcement).toContain("自動選取");
  });

  it("keeps an existing selection and only announces the updated list", () => {
    const plan = planLiveScriptRefresh({ ...base, selectedId: "script-1", fetched: [created, existing] });
    expect(plan.autoSelectId).toBeNull();
    expect(plan.options.map((script) => script.id)).toEqual(["script-2", "script-1"]);
    expect(plan.announcement).toContain("已更新清單");
    expect(plan.announcement).toContain("目前選擇不變");
  });

  it("does not guess between several new scripts", () => {
    const plan = planLiveScriptRefresh({ ...base, fetched: [created, another, existing] });
    expect(plan.autoSelectId).toBeNull();
    expect(plan.options).toHaveLength(3);
    expect(plan.announcement).toContain("新增 2 個互動腳本");
  });

  it("does not select while the studio is submitting", () => {
    const plan = planLiveScriptRefresh({ ...base, canAutoSelect: false, fetched: [created, existing] });
    expect(plan.autoSelectId).toBeNull();
    expect(plan.options.map((script) => script.id)).toContain("script-2");
  });

  it("never duplicates a script, even one the server repeats", () => {
    const plan = planLiveScriptRefresh({ ...base, fetched: [existing, created, created] });
    expect(plan.options.map((script) => script.id)).toEqual(["script-2", "script-1"]);
    expect(plan.autoSelectId).toBe("script-2");
  });

  it("stays silent on an automatic refresh without news and answers a manual one", () => {
    const automatic = planLiveScriptRefresh({ ...base, fetched: [existing] });
    expect(automatic).toEqual({ options: [existing], autoSelectId: null, announcement: "" });
    const manual = planLiveScriptRefresh({ ...base, manual: true, fetched: [existing] });
    expect(manual.announcement).toBe("已更新清單，沒有新的互動腳本。");
    expect(manual.autoSelectId).toBeNull();
  });

  it("keeps a known script the fetch no longer lists, so the select never drops the current choice", () => {
    const plan = planLiveScriptRefresh({ ...base, selectedId: "script-1", fetched: [] });
    expect(plan.options).toEqual([existing]);
  });
});
