/**
 * Merchant-facing messages for the 自訂程式碼 refusals (`LandingPageInputError`
 * codes). Shared by the page editor action and the template library so both
 * explain the same gate the same way.
 */
export const FUNNEL_CUSTOM_CODE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  landing_page_custom_code_role: "只有商家擁有者（owner）或管理員（admin）可以新增、修改或刪除自訂程式碼與頁面自訂 CSS，這次變更沒有儲存。",
  landing_page_custom_code_email_unverified: "頁面含有自訂 JavaScript，必須先完成 Email 驗證才能儲存或發布。請到「驗證 Email」完成後再試。",
  landing_page_custom_code_disabled: "平台已暫時停用自訂 JavaScript，目前無法新增或修改 JS；你仍可刪除 JS 或編輯其他內容。",
  landing_page_custom_css_invalid: "頁面自訂 CSS 含有不支援或不安全的語法，這次變更沒有儲存。請依頁面設定中的錯誤提示修正。",
  landing_page_custom_code_too_large: "自訂程式碼超過大小上限（HTML 50 KB、CSS 20 KB、JS 50 KB），這次變更沒有儲存。",
};

export function funnelCustomCodeErrorMessage(code: string): string | null {
  return Object.hasOwn(FUNNEL_CUSTOM_CODE_ERROR_MESSAGES, code) ? FUNNEL_CUSTOM_CODE_ERROR_MESSAGES[code]! : null;
}
