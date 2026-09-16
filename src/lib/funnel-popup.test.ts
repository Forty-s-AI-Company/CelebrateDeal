import { describe, expect, it } from "vitest";

import {
  bindPopupToPage,
  createPopup,
  deletePopup,
  getFunnelPopupTriggerEligibility,
  updatePopup,
  validatePopupTrigger,
} from "@/lib/funnel-popup";
import {
  createEmptyPageDocument,
  deserializePageDocument,
  serializePageDocument,
} from "@/lib/funnel-page-document";

function popupDocument() {
  return createEmptyPageDocument("page_popup", "Popup 測試頁");
}

function firstPopup(document: ReturnType<typeof popupDocument>) {
  const popup = document.popups[0];
  if (!popup) throw new Error("測試需要 Popup");
  return popup;
}

describe("Funnel Popup domain operations", () => {
  it("建立可獨立編輯的 Section → Row → Column → elements 樹", () => {
    const document = createPopup(popupDocument(), { id: "welcome", name: "歡迎視窗" });
    expect(document).not.toBeNull();
    const popup = firstPopup(document!);
    expect(popup.name).toBe("歡迎視窗");
    expect(popup.settings.showCloseButton).toBe(false);
    expect(popup.capabilities.exitIntent.status).toBe("unverified");

    const section = popup.root[0];
    const row = section?.children?.[0];
    const column = row?.children?.[0];
    expect([section?.type, row?.type, column?.type]).toEqual(["section", "row", "columns_2"]);
    expect(column?.children?.map((child) => child.type)).toEqual(["headline", "text", "button"]);
  });

  it("CRUD 與頁面綁定都會回到合法 PageDocument", () => {
    const created = createPopup(popupDocument(), { name: "延遲提示" });
    expect(created).not.toBeNull();
    const popupId = firstPopup(created!).id;

    const updated = updatePopup(created!, popupId, {
      name: "更新後提示",
      pageId: "landing_page",
      settings: {
        showCloseButton: true,
        automaticDelaySeconds: 5,
        backgroundColor: "#ffffff",
        padding: 32,
        borderStyle: "dashed",
        shadow: "medium",
      },
    });
    expect(updated).not.toBeNull();
    expect(firstPopup(updated!).name).toBe("更新後提示");
    expect(firstPopup(updated!).pageId).toBe("landing_page");
    expect(firstPopup(updated!).settings.automaticDelaySeconds).toBe(5);
    expect(firstPopup(updated!).settings.showCloseButton).toBe(true);

    const unbound = bindPopupToPage(updated!, popupId, null);
    expect(unbound).not.toBeNull();
    expect(firstPopup(unbound!).pageId).toBeUndefined();

    const deleted = deletePopup(unbound!, popupId);
    expect(deleted).not.toBeNull();
    expect(deleted!.popups).toHaveLength(0);
    expect(deletePopup(deleted!, popupId)).toBeNull();
  });

  it("自動延遲可預覽，延遲值以毫秒明確回傳", () => {
    const created = createPopup(popupDocument(), { settings: { automaticDelaySeconds: 2.5 } });
    const popup = firstPopup(created!);
    const result = validatePopupTrigger(popup, "automatic_delay");
    expect(result).toMatchObject({ status: "available", executable: true, canTrigger: true, delayMs: 2500 });

    const disabled = updatePopup(created!, popup.id, { settings: { openAutomatically: false } });
    expect(validatePopupTrigger(firstPopup(disabled!), "automatic_delay")).toMatchObject({ status: "disabled", executable: false });
  });

  it("Exit intent 明確回傳 unverified，不可靜默執行", () => {
    const created = createPopup(popupDocument(), { settings: { openOnExitIntent: true } });
    const popup = firstPopup(created!);
    const result = validatePopupTrigger(popup, "exit_intent");
    expect(result.status).toBe("unverified");
    expect(result.executable).toBe(false);
    expect(result.canTrigger).toBe(false);

    const pageResult = getFunnelPopupTriggerEligibility(created!, popup.id, "exit_intent");
    expect(pageResult).toEqual(result);
  });

  it("不接受會造成重複 ID 或非法設定的 mutation", () => {
    const document = createPopup(popupDocument(), { id: "popup_a" });
    const second = createPopup(document!, { id: "popup_a" });
    expect(second).not.toBeNull();
    expect(second!.popups.map((popup) => popup.id)).toEqual(["popup_a", "popup_a_2"]);
    expect(updatePopup(second!, "popup_a", { settings: { padding: -1 } })).toBeNull();
    expect(bindPopupToPage(second!, "popup_a", "含中文")).toBeNull();
  });

  it("serialize/deserialize round-trip 保留 Popup 樹與設定", () => {
    const document = createPopup(popupDocument(), {
      id: "roundtrip",
      name: "往返測試",
      settings: { showCloseButton: true, automaticDelaySeconds: 9, width: "min(90vw, 640px)" },
    });
    expect(document).not.toBeNull();
    expect(firstPopup(document!).root[0]?.style.width).toBe("min(90vw, 640px)");
    const restored = deserializePageDocument(serializePageDocument(document!));
    expect(restored).toEqual(document);
  });
});
