"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { TURNSTILE_RESPONSE_FIELD, TURNSTILE_SCRIPT_URL, type TurnstileAction } from "@/lib/turnstile";

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string | undefined;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Cloudflare Turnstile widget (explicit rendering, so it also works after a
 * client-side navigation). The widget writes its token into the hidden
 * `cf-turnstile-response` field of the surrounding form; the server action
 * verifies it with siteverify. Rendered only when the server passes a site key.
 */
export function TurnstileWidget({ siteKey, action }: { siteKey: string; action: TurnstileAction }) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const renderWidget = useCallback(() => {
    const api = window.turnstile;
    if (!api || !container.current || widgetId.current) return;
    widgetId.current = api.render(container.current, {
      sitekey: siteKey,
      action,
      language: "zh-tw",
      "response-field-name": TURNSTILE_RESPONSE_FIELD,
    }) ?? null;
  }, [siteKey, action]);

  useEffect(() => {
    // The script may already be loaded by an earlier page.
    renderWidget();
    return () => {
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [renderWidget]);

  return (
    <div className="grid gap-1.5" data-turnstile-widget="">
      <Script src={TURNSTILE_SCRIPT_URL} strategy="afterInteractive" onReady={renderWidget} onError={() => setLoadFailed(true)} />
      <div ref={container} className="min-h-[65px]" />
      {loadFailed ? <p role="alert" className="text-sm text-red-700">真人驗證元件無法載入，請確認網路連線後重新整理頁面。</p> : null}
    </div>
  );
}
