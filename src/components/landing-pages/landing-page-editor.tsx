"use client";

import { Puck, type Data } from "@puckeditor/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { createEmptyLandingPageContent, parseLandingPageContent, type LandingPageContent, type LandingPageRenderContext } from "@/lib/landing-page-content";
import { createLandingPagePuckConfig } from "./landing-page-puck-config";

export type LandingPageEditorProps = {
  content: LandingPageContent | null;
  onChange: (content: LandingPageContent) => void;
  forms: LandingPageRenderContext["forms"];
  live?: LandingPageRenderContext["live"];
  disabled?: boolean;
  onValidityChange?: (valid: boolean) => void;
};

function normalize(content: LandingPageContent | null) {
  return content ?? createEmptyLandingPageContent();
}
const viewports = [
  { width: 375, height: "auto" as const, icon: "Smartphone" as const, label: "手機預覽" },
  { width: 1440, height: "auto" as const, icon: "Monitor" as const, label: "桌機預覽" },
];

/**
 * Client-only Puck integration. Puck owns the live draft history, while the
 * parent receives validated envelope snapshots through onChange.
 */
export function LandingPageEditor({ content, onChange, forms, live, disabled = false, onValidityChange }: LandingPageEditorProps) {
  const initial = normalize(content);
  const [session, setSession] = useState(() => ({ key: 0, content: initial }));
  const emittedJson = useRef(JSON.stringify(initial));
  const [isValid, setIsValid] = useState(true);
  const formsKey = JSON.stringify(forms);
  const config = useMemo(() => createLandingPagePuckConfig({ forms: JSON.parse(formsKey) as LandingPageRenderContext["forms"] }), [formsKey]);
  const liveKey = JSON.stringify(live ?? null);
  const metadata = useMemo(() => ({ forms: JSON.parse(formsKey), live: JSON.parse(liveKey) }), [formsKey, liveKey]);

  useEffect(() => {
    const next = normalize(content);
    const nextJson = JSON.stringify(next);
    if (nextJson === emittedJson.current) return;
    emittedJson.current = nextJson;
    setSession((current) => ({ key: current.key + 1, content: next }));
  }, [content]);

  return <>{!isValid ? <p role="alert" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">頁面內容尚未完成，請修正按鈕動作或欄位後再儲存。</p> : null}<Puck
    key={session.key}
    config={config}
    data={session.content.data as Data}
    height="calc(100dvh - 8rem)"
    headerTitle="CelebrateDeal Funnel 編輯器"
    viewports={viewports}
    metadata={metadata}
    permissions={disabled ? { delete: false, duplicate: false, drag: false, edit: false } : undefined}
    onChange={(data) => {
      const next = parseLandingPageContent({ schemaVersion: 1, data });
      if (!next) {
        setIsValid(false);
        onValidityChange?.(false);
        return;
      }
      setIsValid(true);
      onValidityChange?.(true);
      emittedJson.current = JSON.stringify(next);
      onChange(next);
    }}
  /></>;
}
