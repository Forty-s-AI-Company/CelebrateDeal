import { LXGW_WenKai_TC, Noto_Sans_TC, Noto_Serif_TC, Space_Grotesk } from "next/font/google";

/**
 * I-2：一頁式網站實際載入的網頁字型（next/font 在建置時自架，訪客瀏覽器不會連到 Google）。
 *
 * - 每個字族只登記一個 CSS 變數，掛在 renderer 根節點；`funnel-typography.ts`
 *   的字型堆疊以 `var(--funnel-font-…)` 引用，後面保留系統字 fallback。
 * - 全部 `preload: false`：繁中字檔很大，只有頁面實際用到的 unicode-range 分片
 *   才會被瀏覽器下載；沒選用的字族不會下載任何檔案。
 * - 新字族要同時登記在這裡與 `FUNNEL_FONT_OPTIONS`，並在 IMPLEMENTING.md 說明。
 */
const notoSansTc = Noto_Sans_TC({ weight: ["400", "700", "800"], display: "swap", preload: false, variable: "--funnel-font-sans-tc", fallback: ["PingFang TC", "Microsoft JhengHei", "sans-serif"] });
const notoSerifTc = Noto_Serif_TC({ weight: ["400", "600", "700"], display: "swap", preload: false, variable: "--funnel-font-serif-tc", fallback: ["Songti TC", "PMingLiU", "serif"] });
const wenkaiTc = LXGW_WenKai_TC({ weight: ["400", "700"], display: "swap", preload: false, variable: "--funnel-font-wenkai-tc", fallback: ["Kaiti TC", "DFKai-SB", "serif"] });
const spaceGrotesk = Space_Grotesk({ weight: ["500", "600", "700"], subsets: ["latin"], display: "swap", preload: false, variable: "--funnel-font-display-latin", fallback: ["system-ui", "sans-serif"] });

/** Class names that declare the font variables; applied to every renderer root (editor, preview, public). */
export const FUNNEL_FONT_VARIABLES = [notoSansTc.variable, notoSerifTc.variable, wenkaiTc.variable, spaceGrotesk.variable].filter(Boolean).join(" ");
