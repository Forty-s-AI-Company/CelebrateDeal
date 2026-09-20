"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { FunnelDocumentCarousel } from "./funnel-document-carousel";
import { FunnelPopupPreview, registerDesktopExitIntent } from "./funnel-popup-preview";
import { SandboxedHtml } from "./sandboxed-html";
import { createEmptyPageDocument, type PageDocument } from "@/lib/funnel-page-document";

function popupDocument(): PageDocument {
  const document = createEmptyPageDocument("browser_harness", "Browser harness");
  document.popups = [{ schemaVersion: 1, id: "exit_popup", name: "Exit Popup", pageId: document.id, settings: { showCloseButton: true, openAutomatically: false, automaticDelaySeconds: 1, openOnExitIntent: true, backgroundColor: "white", padding: 24, cornerRadius: 6, borderStyle: "solid", borderColor: "#e2e8f0", borderWidth: 1, shadow: "soft" }, capabilities: { exitIntent: { status: "available", reason: "desktop verified" } }, root: [] }];
  return document;
}

export function FunnelAdvancedBrowserHarness() {
  const [mounted, setMounted] = useState(true);
  const [triggerStatus, setTriggerStatus] = useState("pending");
  const [exitCount, setExitCount] = useState(0);
  const exitCleanup = useRef<(() => void) | null>(null);
  const document = useMemo(() => popupDocument(), []);
  const onTriggerStatus = useCallback((status: { status: string }) => setTriggerStatus(status.status), []);
  return <main><div id="admin-sentinel">safe</div><SandboxedHtml label="Raw HTML harness" html={'<script>parent.document.querySelector("#admin-sentinel").textContent="pwned"</script><a href="javascript:alert(1)">bad</a><p>safe html</p>'} /><FunnelDocumentCarousel id="browser-carousel" label="Browser carousel"><a href="#one">第一張</a><a href="#two">第二張</a><a href="#three">第三張</a></FunnelDocumentCarousel><button type="button" onClick={() => setMounted(false)}>卸載 Popup</button><button type="button" onClick={() => { exitCleanup.current?.(); exitCleanup.current = registerDesktopExitIntent(() => setExitCount((value) => value + 1)).cancel; }}>啟用 Exit Intent 測試</button><button type="button" onClick={() => { exitCleanup.current?.(); exitCleanup.current = null; }}>清理 Exit Intent 測試</button><output data-exit-count>{exitCount}</output><output data-popup-trigger-ready>{triggerStatus}</output>{mounted ? <FunnelPopupPreview document={document} popupId="exit_popup" publicSurface onTriggerStatus={onTriggerStatus} /> : <output data-popup-unmounted>unmounted</output>}</main>;
}
