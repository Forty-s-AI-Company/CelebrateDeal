import type { ReactNode } from "react";
import { isFunnelCustomCodeDisabled } from "@/lib/funnel-custom-code";
import { FunnelCustomCodeSurfaceProvider } from "./sandboxed-html";

/**
 * Server component：在伺服器讀取緊急開關 `FUNNEL_CUSTOM_CODE_DISABLED`，傳給
 * client 端的自訂程式碼 iframe。公開頁、後台編輯器與 Funnel 管理頁都包在這裡面；
 * 沒有包的畫面一律不執行商家 JS（context 預設 fail-closed）。
 */
export function FunnelCustomCodeRuntime({ allowPopups = false, children }: { allowPopups?: boolean; children: ReactNode }) {
  return <FunnelCustomCodeSurfaceProvider allowPopups={allowPopups} scriptsEnabled={!isFunnelCustomCodeDisabled()}>{children}</FunnelCustomCodeSurfaceProvider>;
}
