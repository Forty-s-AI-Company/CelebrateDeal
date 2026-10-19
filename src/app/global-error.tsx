"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useState } from "react";

// global-error 會取代根 layout，不會載入全站樣式，所以這裡用行內樣式。
const buttonStyle = {
  minHeight: 44,
  padding: "0 16px",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
} as const;

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="zh-Hant">
      <body style={{ margin: 0, minHeight: "100vh", background: "#f1f5f9", color: "#0f172a", fontFamily: "system-ui, -apple-system, 'Noto Sans TC', sans-serif" }}>
        <main style={{ maxWidth: 520, margin: "0 auto", padding: "48px 16px" }}>
          <section role="alert" style={{ background: "#fff", borderRadius: 16, padding: 32, boxShadow: "0 1px 2px rgba(0,0,0,.08)", textAlign: "center" }}>
            <h1 style={{ margin: 0, fontSize: 22 }}>系統暫時無法顯示這個頁面</h1>
            <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6, color: "#475569" }}>我們已收到通知。請重新載入，或回首頁再試一次。</p>
            <div style={{ marginTop: 24, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={retrying}
                onClick={() => { setRetrying(true); retry(); }}
                style={{ ...buttonStyle, border: 0, background: "#2563eb", color: "#fff", opacity: retrying ? 0.6 : 1 }}
              >
                {retrying ? "正在重新載入…" : "重新載入"}
              </button>
              {/* 根 layout 已失效，需要整頁重新載入，所以刻意不用 next/link。 */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" style={{ ...buttonStyle, border: "1px solid #cbd5e1", background: "#fff", color: "#334155" }}>回首頁</a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
