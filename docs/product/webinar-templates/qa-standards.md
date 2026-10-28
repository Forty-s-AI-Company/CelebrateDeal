# Webinar 範本品質規範：不跑版的驗收標準

> 適用於 `specs/01～20` 的全部範本、`shared-components.md` 的新元件，以及重設計的功能頁（感謝頁、播放頁、隱私權、條款）。
> 每一條都寫成可以自動檢查的形式。§6 是給實作者的檢查清單，§5 是自動化方式。

## 1. 驗收寬度

| 寬度 | 代表裝置 | 公開頁目前的 viewport | 平板斷點（I-1）完成後 |
|---|---|---|---|
| 1440 | 桌機 | desktop | desktop |
| 1280 | 筆電 | desktop | desktop |
| 1024 | 平板橫向、小筆電 | desktop | 平板（斷點 640–1079；4 欄降成 2 欄） |
| 768 | 平板直向 | desktop | 平板 |
| 390 | iPhone 13–16 | mobile | mobile |
| 375 | iPhone SE（第 2、3 代）、iPhone 12／13 mini | mobile | mobile |
| 360 | 小尺寸 Android | mobile | mobile |
| 320 | iPhone SE 第 1 代、系統字級放大後的等效寬度 | mobile | mobile（**降級驗收**，見下方說明） |

- 高度一律用 900（桌機、平板）與 844（手機）。另外在 375×667（iPhone SE 的實際螢幕）加測首屏的報名入口。
- 1440～360 共 7 種寬度：L-1～L-12 全部要通過。
- 320 寬只要求 L-1、L-3、L-5、L-11（不得水平捲動、文字不被裁切、按鈕完整可點、表單可用），字級可以比 §3.1 下限小 2px（內文仍 ≥ 16px），版面不求美觀。
- 每個寬度都要在**真正的公開頁渲染路徑**上測（`PublicFunnelDocument`，讓 matchMedia 自行判斷），不能只用編輯器強制的 viewport。
- 加測：瀏覽器縮放 200%（相當於 720 寬的 1440 版面）、系統字級放大（根字級 20px）。

## 2. 不跑版的定義（硬性，全部要通過）

| # | 檢查 | 判定方式 |
|---|---|---|
| L-1 | 沒有水平捲動 | `document.documentElement.scrollWidth <= window.innerWidth`（容許 0px） |
| L-2 | 沒有元素超出視窗 | 所有可見元素的 `getBoundingClientRect().right <= innerWidth + 0.5` 且 `left >= -0.5`。例外：有 `overflow-x: auto` 的內部捲動容器（例如 `code_snippet`）的子元素，以及裝飾用 `aria-hidden` 且父層有 `overflow: hidden` 的元素 |
| L-3 | 文字沒有被裁切 | 文字節點的元素若 `overflow` 不是 visible，必須 `scrollWidth <= clientWidth + 1` 且 `scrollHeight <= clientHeight + 1`。不允許用 `text-overflow: ellipsis` 截斷標題、按鈕或表單標籤 |
| L-4 | 文字沒有溢出容器 | 每個 headline／text／button 的 `getBoundingClientRect()` 必須落在最近的 section 內容寬度內 |
| L-5 | 按鈕完整可見且可點 | 每個 `button`／`a[role=button]`／submit：寬高 ≥ 44×44（主要 CTA 高度 ≥ 48），矩形完全在視窗水平範圍內，文字最多 2 行，`elementFromPoint` 取按鈕中心點時拿到的是按鈕本身或它的子元素（沒有被固定列或裝飾蓋住） |
| L-6 | 圖片不變形 | `object-fit` 不是 cover／contain 的 `img`：`|渲染寬/高 − naturalWidth/naturalHeight| / 原比例 ≤ 2%`。SVG 要有 viewBox，並保留 `preserveAspectRatio` 預設值 |
| L-7 | 首屏有報名入口 | 375×667 時，首屏內要看得到「報名表單的第一個欄位」或「主要 CTA 按鈕」（`getBoundingClientRect().top < 667`，同樣在 390×844 檢查）；捲過首屏後，固定報名列（C-04）要出現 |
| L-8 | 固定列不遮內容 | 固定報名列出現時：頁尾最後一個元素（平台揭露、政策連結）捲到底時完全可見；表單 submit 按鈕不被遮住 |
| L-9 | 沒有版面跳動 | 載入後 CLS < 0.1（Lighthouse 或 PerformanceObserver `layout-shift`）。手機第一次 render 不得先出現桌機欄數再切換（I-1） |
| L-10 | 欄位不擠壞 | 任一欄（grid 子項）的內容寬度 ≥ 240px（桌機、平板）。不足時這個斷點必須降欄 |
| L-11 | 表單可用 | 輸入框寬度 ≥ 260px（360 寬時 ≥ 280px），標籤不截斷，錯誤訊息出現時不推擠出水平捲動 |
| L-12 | 長內容不壞版 | 用「壓力測試文案」替換後（§4），L-1～L-5 仍然通過 |

## 3. 文字排版規則

### 3.1 字級下限（以 CSS px 計）

| 元素 | 桌機（≥1024） | 平板 | 手機（≤639） |
|---|---|---|---|
| H1（hero 標題） | 44–64 | 36–48 | **28–36**（不得 < 28、不得 > 40） |
| H2（區塊標題） | 32–40 | 28–34 | 24–28 |
| H3（卡片標題） | 20–24 | 20–22 | 18–20 |
| 內文 | 17–18 | 16–17 | **≥ 16** |
| lead（副標） | 19–22 | 18–20 | 17–18 |
| small（註解、標籤） | 14 | 14 | **≥ 14**（繁中筆畫多，12px 以下不可讀） |
| eyebrow | 13–14（字距 0.12em） | 13 | ≥ 13 |
| 按鈕 | 17–18，粗體 | 17 | ≥ 16 |
| 表單輸入 | 16 | 16 | **= 16 以上**（避免 iOS 點擊時自動放大） |
| 倒數數字 | 36–56 | 32–44 | 28–36 |

- 行高：內文 1.7–1.85、標題 1.2–1.35（繁中的標題行高不可低於 1.2，否則上下行會互相碰到）。
- 行長：內文容器 `max-width` 繁中 34–40 字（約 640–720px），英數混排不超過 75ch。

### 3.2 標題換行規則

1. 所有 headline 使用 `text-wrap: balance`（現有 renderer 已設定），內文用 `text-wrap: pretty`。
2. **行數上限**：H1 在桌機最多 2 行、在 360 寬最多 4 行；H2 在桌機最多 2 行、在 360 寬最多 3 行。超過就屬於文案或字級問題，必須修正，不能把字級縮到下限以下。
3. **孤字**：最後一行不得只剩 1 個中文字或 1 個標點（自動檢查：用 `Range.getClientRects()` 取得最後一行寬度，必須 ≥ 2 個字寬）。範本文案如果有風險，用 `\n` 手動斷行或改寫，不加 `&nbsp;`。
4. **避頭尾**：設定 `line-break: strict`，避免「，。、」！？」出現在行首。
5. **英數長字**：網址、長英文單字、數字串要允許斷開（`overflow-wrap: anywhere`，只用在 text 與表單說明；headline 維持 `break-word`）。
6. **不得用 `word-break: keep-all`** 處理繁中，它會讓整句中文不換行而溢出。
7. 手機版不得用 `<br>` 或 `\n` 硬斷行製造桌機的視覺效果。若桌機需要特定斷點，用 mobile override 把 `\n` 換成空字串。

### 3.3 對比（WCAG 2.2 AA）

| 對象 | 最低對比 |
|---|---|
| 內文、small、表單標籤、placeholder | 4.5:1 |
| 大字：≥ 24px，或 ≥ 18.66px 且粗體 | 3:1 |
| 按鈕文字對按鈕底色 | 4.5:1 |
| 輸入框邊框、焦點框、圖示等非文字元素對相鄰背景 | 3:1 |
| 疊在圖片／漸層上的文字 | 依最差區域計算 4.5:1；做不到就加 ≥ 60% 的遮罩 |

- 每份 spec 的配色表都已預先算好主要組合的對比值（相對亮度公式同 `funnel-design-contrast.ts`）。
- 自動檢查：對範本文件跑 `findFunnelContrastIssues(document, 4.5)`，並在瀏覽器中用 axe-core `color-contrast` 規則複查，雙重確認。
- 金色、亮黃、螢光綠等亮色**只能放在深色底上**，或只用在 ≥ 24px 的大字與裝飾。淺色底的小字改用同色系的深色版（例如 #497 在米色底用古銅色 `#7d5f32` 取代金色）。

### 3.4 互動與動畫

- `prefers-reduced-motion: reduce` 時：停用捲動動畫、數字跳動、marquee、輪播自動播放；倒數改成每分鐘更新。
- 自動播放的內容超過 5 秒，必須有暫停鍵（WCAG 2.2.2）。
- 焦點框清楚可見（2px 實線、對比 3:1），固定報名列不得蓋住取得焦點的元素（WCAG 2.4.11）。
- 影片不自動播放有聲內容；背景影片一律靜音、無控制列時改成靜態海報。

### 3.5 效能

- LCP < 2.5s（4G 模擬、390 寬）；hero 圖片 ≤ 200KB，SVG ≤ 60KB。
- 每頁最多兩個字族、四個字重（I-2）。
- 不載入任何第三方追蹤或字型以外的外部資源（追蹤由 #499 的設定控制，範本不預設）。

## 4. 壓力測試文案

每個範本都要再用一份「壓力文案」渲染並通過 L-1～L-5：

- 標題與按鈕文字加長 1.5 倍（在原文後面重複一段）。
- 講者姓名改成 12 字中文，以及 `Alexandria Montgomery-Christensen` 這類長英文姓名。
- 插入一個 60 字元、沒有空白的網址或英文串。
- 「你將學到」與議程的項目數改成最大值（各 8 項）。
- 數字改成 `NT$1,280,000`、`12,345+`。
- 評價改成 300 字的長評價。

## 5. 自動化建議

### 5.1 測試入口

- 沿用 `src/app/browser-qa/funnel-design` harness（`?template=<id>`），但新增 `viewport=responsive` 模式：直接渲染 `PublicFunnelDocument`、不強制 viewport，讓 matchMedia 與 CSS 自行判斷。
- 新增 `&stress=1` 參數：harness 把文件中的文字替換成 §4 的壓力文案（只在 browser-qa 路由生效，正式環境不提供）。
- 執行方式沿用 `scripts/funnel-elements-browser-qa.mjs` 的鏡像目錄模式（不讀 `.env`），新增 `playwright.webinar-templates.config.ts`，例如 `npm run e2e:webinar-templates`。

### 5.2 Playwright 檢查腳本骨架（示意，實作時再寫成正式程式）

```ts
const WIDTHS = [1440, 1280, 1024, 768, 390, 375, 360] as const; // 320 另跑降級檢查
for (const id of WEBINAR_TEMPLATE_IDS) for (const width of WIDTHS) for (const stress of [false, true]) {
  test(`${id} @${width}${stress ? " stress" : ""}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 640 ? 844 : 900 });
    await page.goto(`/browser-qa/funnel-design?template=${id}&viewport=responsive${stress ? "&stress=1" : ""}`);
    await page.evaluate(() => document.fonts.ready);
    const report = await page.evaluate(runLayoutChecks); // L-1～L-6、L-10、L-11、§3.1、§3.2 的孤字與行數
    expect(report.failures).toEqual([]);
    await expect(page).toPassAxe({ rules: ["color-contrast", "target-size", "image-alt", "label"] });
  });
}
```

`runLayoutChecks` 在瀏覽器內執行，回傳 `{ rule, nodeId, detail }[]`。`nodeId` 取自 renderer 已輸出的 `data-funnel-node-id`（另有 `data-funnel-node-type`），失敗可以直接對應到範本節點。

### 5.3 單元層檢查（不需要瀏覽器）

- 每個範本：`parsePageDocument(previewWebinarTemplate(id))` 成功。
- 節點 ID 快照。
- `findFunnelContrastIssues` 回傳空陣列。
- 文件中不含 `raw_html`。
- 所有 `image.src` 都指向 `public/funnel-illustrations/webinar/**` 或佔位圖。
- 文字中沒有寫死的日期格式（regex `/20\d\d[年\/-]/`），日期只能來自 C-01／C-06 的資料來源。
- 評價卡含「範本示意」標記。

### 5.4 視覺回歸（選做）

- 1440 與 390 截圖存進不合併的截圖分支（沿用 #497 的做法），PR 描述附連結。
- 之後若導入像素比對，閾值設 0.2%。

## 6. 實作者檢查清單（每個範本 PR 都要貼在 PR 描述中勾選）

- [ ] 7 種寬度（1440～360）× 一般／壓力文案，另加 320 降級檢查，L-1～L-12 全部通過（附自動檢查輸出）
- [ ] H1 在 360 寬 ≤ 4 行，沒有孤字；手機 H1 介於 28–36px
- [ ] 手機內文 ≥ 16px、small ≥ 14px、輸入框 ≥ 16px
- [ ] `findFunnelContrastIssues` 與 axe `color-contrast` 皆 0 筆
- [ ] 按鈕 ≥ 44×44（主要 CTA 高度 ≥ 48），沒有被固定報名列遮住
- [ ] 375×667 首屏看得到報名入口；捲過首屏後出現固定報名列
- [ ] reduced motion 下沒有任何動畫或自動播放
- [ ] 日期與時間來自 webinar 設定；沒有寫死的假名額或假倒數
- [ ] 評價、Logo、數據都標示範本示意；文件中沒有 `raw_html`
- [ ] CLS < 0.1；hero 圖 ≤ 200KB
- [ ] 節點 ID 快照測試、typecheck、lint 通過
- [ ] 附 1440／390 截圖連結
