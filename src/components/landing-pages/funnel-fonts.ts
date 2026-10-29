import "./funnel-fonts.css";

/**
 * I-2：一頁式網站實際載入的網頁字型，自架在 `public/fonts/funnel/`（`funnel-fonts.css`）。
 *
 * - 建置與訪客瀏覽都不連到 Google：字檔是 Google Fonts 的 unicode-range 分片（思源黑體、思源宋體、
 *   霞鶩文楷 TC、Space Grotesk），瀏覽器只下載頁面實際用到的字與字重；沒選用的字族不會下載任何檔案。
 *   之前用 `next/font/google` 時，每次 `next build` 都要下載約 450 個分片，任何一次網路中斷都會讓建置失敗。
 * - 每個字族只有一個 CSS 變數，由 `.funnel-font-vars` 掛在 renderer 根節點；`funnel-typography.ts`
 *   的字型堆疊以 `var(--funnel-font-…)` 引用，後面保留系統字 fallback。
 * - 新字族要同時登記在 `funnel-fonts.css`、`FUNNEL_FONT_OPTIONS` 與 public/fonts/funnel/README.md。
 */
export const FUNNEL_FONT_VARIABLES = "funnel-font-vars";
