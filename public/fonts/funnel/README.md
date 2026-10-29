# 一頁式網站網頁字型（自架）

`src/components/landing-pages/funnel-fonts.css` 引用這個資料夾的 woff2 檔。這些檔案是 Google Fonts 提供的 unicode-range 分片，與 `next/font/google` 在建置時下載的檔案相同。改成自架後，`next build` 不再需要連到 Google；訪客的瀏覽器也一樣不會連到 Google。

| 字族（CSS family） | 原字型 | 字重 | 授權 |
|---|---|---|---|
| Funnel Noto Sans TC | Noto Sans TC（思源黑體） | 400、700、800 | SIL Open Font License 1.1 |
| Funnel Noto Serif TC | Noto Serif TC（思源宋體） | 400、600、700 | SIL Open Font License 1.1 |
| Funnel LXGW WenKai TC | LXGW WenKai TC（霞鶩文楷 TC） | 400、700 | SIL Open Font License 1.1 |
| Funnel Space Grotesk | Space Grotesk | 500、600、700（latin） | SIL Open Font License 1.1 |

- 授權全文：https://openfontlicense.org/open-font-license-official-text/
- 字型可以自由使用、內嵌與再散布，但不可以單獨販售字檔。改名後的字族名稱（加上 `Funnel` 前綴）只用來避免與訪客電腦上已安裝的同名字型衝突，字形本身沒有修改。

## 更新或新增字族

1. 在暫時的分支，用 `next/font/google` 宣告要的字族與字重，然後執行 `next build`。
2. 從 `.next/static/css/*.css` 取出該字族的 `@font-face`（包括 `… Fallback`）。
3. 把 `/_next/static/media/<檔名>` 改成 `/fonts/funnel/<檔名>`，並把字族名稱加上 `Funnel` 前綴。
4. 把對應的 woff2 複製到這個資料夾。
5. 在 `funnel-fonts.css` 的 `.funnel-font-vars` 登記 CSS 變數，並同步更新 `FUNNEL_FONT_OPTIONS` 與上表。
