import Link from "next/link";
import type { CSSProperties } from "react";

/**
 * 平台揭露。放在頁面內容容器（`[data-funnel-content]`）之外，商家自訂 CSS 的
 * 選擇器一律以容器開頭，所以選不到這裡；字型只用無法被 @font-face 覆寫的
 * 通用字型關鍵字。內容只在頁面含有自訂程式碼或自訂 CSS 時顯示。
 */
const disclosureStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  display: "block",
  margin: 0,
  padding: "12px 16px",
  background: "#f8fafc",
  color: "#334155",
  borderTop: "1px solid #e2e8f0",
  fontFamily: "system-ui, sans-serif",
  fontSize: "12px",
  lineHeight: 1.6,
  textAlign: "center",
  visibility: "visible",
  opacity: 1,
};
const linkStyle: CSSProperties = { color: "#1d4ed8", textDecoration: "underline" };

export function FunnelCustomCodeDisclosure({ summary }: { summary: { any: boolean; scripts: boolean } }) {
  if (!summary.any) return null;
  return <aside data-funnel-platform-disclosure aria-label="CelebrateDeal 平台說明" style={disclosureStyle}>
    <p style={{ margin: 0 }}>
      本頁由商家建立並管理。{summary.scripts ? "部分互動內容為商家自訂腳本，在隔離環境中執行，無法讀取你在 CelebrateDeal 的登入資料。" : "頁面含有商家自訂的版面內容。"}
    </p>
    <p style={{ margin: "4px 0 0" }}>
      <Link href="/policies/terms" style={linkStyle}>使用條款</Link>
      <span aria-hidden> ・ </span>
      <Link href="/policies/privacy" style={linkStyle}>隱私通知</Link>
    </p>
  </aside>;
}
