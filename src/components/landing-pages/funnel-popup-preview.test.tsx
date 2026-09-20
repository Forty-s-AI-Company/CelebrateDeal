import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmptyPageDocument, type FunnelNode, type FunnelPopup, type PageDocument } from "@/lib/funnel-page-document";
import { FunnelPopupPreview, getFunnelPopupExitIntentStatus, scheduleFunnelPopupOpen } from "@/components/landing-pages/funnel-popup-preview";

function node(type: FunnelNode["type"], id: string, props: Record<string, unknown> = {}, children?: FunnelNode[]): FunnelNode {
  return { schemaVersion: 1, id, type, props, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, ...(children ? { children } : {}) };
}

function popup(overrides: Partial<FunnelPopup["settings"]> = {}, root: FunnelNode[] = [node("section", "popup-section", {}, [node("row", "popup-row", {}, [node("text", "popup-text", { text: "Popup 內容" })])])]): FunnelPopup {
  return {
    schemaVersion: 1,
    id: "popup-test",
    name: "測試 Popup",
    settings: {
      showCloseButton: false,
      openAutomatically: true,
      automaticDelaySeconds: 2,
      openOnExitIntent: false,
      backgroundColor: "white",
      padding: 24,
      cornerRadius: 6,
      borderStyle: "solid",
      borderColor: "#e2e8f0",
      borderWidth: 1,
      shadow: "soft",
      ...overrides,
    },
    root,
    capabilities: { exitIntent: { status: "unverified", reason: "尚未完成跨瀏覽器 Exit intent 驗證" } },
  };
}

function documentWith(candidate: FunnelPopup): PageDocument {
  return { ...createEmptyPageDocument("popup-page", "Popup 頁面"), popups: [candidate] };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("FunnelPopupPreview", () => {
  it("uses the configured delay for normal preview and opens after fake time advances", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const scheduled = scheduleFunnelPopupOpen(popup(), { onOpen });

    expect(scheduled.status.status).toBe("available");
    expect(scheduled.status.delayMs).toBe(2_000);
    expect(onOpen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_999);
    expect(onOpen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens immediately in editor preview and renders the configured close button", () => {
    const candidate = popup({ showCloseButton: true, backgroundColor: "#fff7ed", padding: 32, borderWidth: 2, shadow: "strong" });
    const html = renderToStaticMarkup(<FunnelPopupPreview document={documentWith(candidate)} popupId={candidate.id} previewEnabled />);

    expect(html).toContain('data-funnel-popup-state="open"');
    expect(html).toContain('data-funnel-popup-close');
    expect(html).toContain('aria-label="關閉 Popup"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("background-color:#fff7ed");
    expect(html).toContain("padding:32px");
    expect(html).toContain("border:2px solid #e2e8f0");
    expect(html).toContain("Popup 內容");
  });

  it("fails closed for a disabled automatic trigger", () => {
    vi.useFakeTimers();
    const candidate = popup({ openAutomatically: false });
    const onOpen = vi.fn();
    const scheduled = scheduleFunnelPopupOpen(candidate, { onOpen });
    vi.advanceTimersByTime(10_000);

    expect(scheduled.status.status).toBe("disabled");
    expect(scheduled.status.executable).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(<FunnelPopupPreview document={documentWith(candidate)} popupId={candidate.id} />);
    expect(html).toContain('data-funnel-popup-state="waiting"');
    expect(html).toContain('data-funnel-popup-status="disabled"');
    expect(html).not.toContain("Popup 內容");
  });

  it("reports exit intent as an explicit desktop capability", () => {
    vi.useFakeTimers();
    const candidate = popup({ openOnExitIntent: true });
    const onOpen = vi.fn();
    const scheduled = scheduleFunnelPopupOpen(candidate, { onOpen });
    vi.advanceTimersByTime(2_000);

    expect(scheduled.status.status).toBe("available");
    expect(getFunnelPopupExitIntentStatus(candidate).status).toBe("available");
    expect(onOpen).toHaveBeenCalledTimes(1);
    const html = renderToStaticMarkup(<FunnelPopupPreview document={documentWith(candidate)} popupId={candidate.id} previewEnabled />);
    expect(html).toContain('data-funnel-popup-exit-intent-status="available"');
  });

  it("renders untrusted raw HTML as a safe capability state inside the overlay", () => {
    const candidate = popup({}, [node("section", "popup-section-safe", {}, [node("row", "popup-row-safe", {}, [node("raw_html", "popup-html", { html: "<script>window.pwned=true</script>" })])])]);
    const html = renderToStaticMarkup(<FunnelPopupPreview document={documentWith(candidate)} popupId={candidate.id} previewEnabled />);

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("window.pwned");
    expect(html).toContain("原始 HTML");
    expect(html).toContain('sandbox=""');
    expect(html).toContain("Content-Security-Policy");
  });
});

