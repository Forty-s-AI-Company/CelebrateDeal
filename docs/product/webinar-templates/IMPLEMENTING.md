# 實作 Webinar 範本：給範本工作階段的說明

> 對象：負責 `specs/01～20` 的範本工作階段。
> 前提：整合分支 `ai/webinar-templates` 已經有全部共用能力，包括平板斷點、字型、捲動動畫、固定報名列、活動時間與 C-01～C-18 元件。
> **範本工作階段只寫範本資料，不改渲染器、元件、PageDocument 契約或登記檔。** 發現元件 bug 或缺少能力時，寫進共用筆記交給主對話，不要在範本分支修熱點檔案。

## 1. 你只會動到的檔案

| 檔案 | 用途 |
|---|---|
| `src/lib/funnel-templates/webinar/NN-<slug>.ts` | 範本定義。已預留，目前是 `export const template = null` |
| `src/lib/funnel-templates/webinar/NN-<slug>.test.ts` | 範本測試。複製 `00-example.test.ts` |
| `src/lib/funnel-templates/webinar/__snapshots__/NN-<slug>.test.ts.snap` | 節點 id 快照，第一次跑測試時產生 |
| `public/funnel-illustrations/webinar/NN/*.svg` | 範本自己的插圖（選用） |

- 登記檔 `index.ts` 已經 import 全部 20 個檔案。把 `null` 換成範本定義後，範本就會出現在範本庫，也會出現在 Webinar 報名頁步驟的選單。
- 不要修改 `index.ts`、`funnel-template-gallery.ts`、`funnel-template-catalog.ts`、`types.ts`。

## 2. 新增一個範本

1. 讀 `specs/NN-<slug>.md`、`qa-standards.md`，以及範例 `00-example.ts`。範例是 specs/01 的簡化版，示範了常用的寫法。
2. 在 `NN-<slug>.ts` 匯出 `template: WebinarTemplateDefinition`：

```ts
import { WEBINAR_TEMPLATE_SAMPLE_MARK, webinarTemplateKit, type WebinarTemplateDefinition } from "./types";

function build(prefix: string) {
  const { node, section, columns2, stack, headline, text, button, form } = webinarTemplateKit(prefix);
  return [
    section("hero", [ /* … */ ], { background: "#ffffff", color: "#2b3245", maxWidth: 640, align: "center" }),
    // …
  ];
}

export const template: WebinarTemplateDefinition = {
  id: "webinar-ai-minimal",           // 與 spec 的「範本 id」相同；上線後不可改
  number: 1,
  name: "AI 工具極簡報名頁",
  description: "一句話說明（範本庫卡片）",
  category: "AI 工具講座",
  purposes: ["webinar"],              // 用途標籤，見 §5
  styles: ["minimal"],                // 風格標籤，見 §5
  preview: { eyebrow: "Webinar", headline: "…", summary: "…", palette: ["#ffffff", "#4f46e5", "#f5f7ff"], sectionCount: 7 },
  theme: { typography: { headingFont: "sans-tc", bodyFont: "sans-tc", bodySize: 18, bodyLineHeight: 1.75, textColor: "#2b3245", headingColor: "#0b1020", linkColor: "#4f46e5" }, background: { color: "#ffffff" } },
  settings: { eventTitle: "…", stickyCta: { enabled: true, label: "免費報名", showDate: true, devices: "mobile_tablet" } },
  build,
};
```

3. 複製 `00-example.test.ts` 成 `NN-<slug>.test.ts`，把 import 改成自己的範本，然後跑：

```bash
npx vitest run src/lib/funnel-templates/webinar
```

   - 第一次跑會產生節點 id 快照。
   - 共用檢查 `webinarTemplateIssues` 必須回傳空陣列，涵蓋：
     - 可解析
     - 沒有 `raw_html`
     - 圖片路徑存在
     - 沒有寫死的日期或固定截止時間的倒數
     - 評價標示「範本示意」
     - 對比 AA
     - 字型合法
     - 有表單、活動資訊列、講者卡、固定報名列
     - 每個區段都有手機內距

4. 跑 §4 的 QA 腳本，附上截圖。
5. 跑 `npm run typecheck` 與 `npm run lint`。

### 節點 id 規則

- 一律透過 `webinarTemplateKit(prefix)` 建立節點，id 會是 `${prefix}_<區塊>_<元素>`，例如 `hero_title`、`hero_form_email`。
- id 要固定、可預測，不要用亂數或時間。已存頁面與分析會參照節點 id，所以合併後不要再改 id、型別或順序（快照測試會擋）。
- 同一頁的 HTML id（`htmlId`，錨點）不可重複。首屏表單建議用 `htmlId: "register"`，頁尾按鈕用 `button(…, "#register")` 捲回表單。

## 3. 可用的元件與寫法

### 3.1 版面與響應式

| 需求 | 寫法 |
|---|---|
| 全寬區段＋置中內容 | `section(id, children, { background, color, maxWidth, paddingY, paddingYTablet, paddingYMobile, align })` |
| 兩欄比例 | `columns2(id, left, right, { ratio: "7:5" })`。可用的比例：1:1、7:5、5:7、3:2、2:3、2:1、1:2 |
| 平板也上下堆疊 | `columns2(…, { stackOn: "tablet" })` |
| 手機先顯示右欄（例如表單在前） | `columns2(…, { mobileOrder: "reverse" })`。會同時反轉閱讀與鍵盤順序 |
| 三、四欄 | `node(id, "columns_3", {}, [stack(…), …])`。平板自動降成 2 欄，手機 1 欄 |
| 覆寫個別裝置 | 節點的 `options` 用 `desktop`／`tablet`／`mobile`，例如 `{ tablet: { style: { fontSize: 40 } }, mobile: { style: { fontSize: 30 } } }` |

- 斷點：≤ 639px 為手機，640–1079px 為平板，≥ 1080px 為桌機。1024 與 768 都是平板。
- 平板的覆寫順序是先套用 `desktop`，再套用 `tablet`。
- 手機標題不要用 `\n` 硬斷行。需要時，用 `mobile: { props: { text: "不含換行的版本" } }` 覆寫。

### 3.2 字型（I-2）

`theme.typography.headingFont` 與 `bodyFont` 只能使用下列值：

| value | 字型 | 適合 |
|---|---|---|
| `sans-tc` | 思源黑體（Noto Sans TC） | 大多數範本的內文與標題 |
| `serif-tc` | 思源宋體（Noto Serif TC） | 高質感、編輯感 |
| `wenkai-tc` | 霞鶩文楷 TC | 手作、溫暖 |
| `display-latin` | Space Grotesk | 數字與英文點綴（中文會退回思源黑體） |
| `system-ui` | 系統字 | — |

- 字型由 next/font 自架，只會下載頁面實際用到的字。
- 每頁最多兩個字族。

### 3.3 頁面設定（`settings`）

| 欄位 | 說明 |
|---|---|
| `eventTitle` | 活動名稱，供 `{{webinar.title}}` 與加入行事曆使用 |
| `scrollReveal` | `"fade"` 或 `"rise"`。只作用在 section 的第一層子節點；reduced motion 時停用；首屏不會閃爍 |
| `stickyCta` | 固定報名列（C-04），所有範本都要開。<br>• 欄位：`label`、`target`（HTML id，留空時捲到第一個表單）、`showDate`、`devices`（`mobile_tablet`，建議）、`buttonColor`、`buttonTextColor`、`backgroundColor`<br>• 行為：捲過首屏後出現；捲到表單或頁尾時自動隱藏 |

### 3.4 活動時間（I-5）：不要寫死日期

- 日期與時間只能來自漏斗的「線上講座排程」。
- 文字中用動態欄位：`{{webinar.date}}`、`{{webinar.time}}`、`{{webinar.startAt}}`、`{{webinar.weekday}}`、`{{webinar.timezone}}`、`{{webinar.duration}}`、`{{webinar.title}}`。
- 沒有排程時，動態欄位與活動資訊列會顯示「時間公布中」。
- 倒數用 `source: "webinar_start"`（開播）或 `"registration_close"`（營運設定的報名截止）。範本不得使用 `fixed`。

### 3.5 元件與主要 props

所有元件的強調色預設是頁面連結色（`theme.typography.linkColor`），可用 `accentColor` 覆寫。

| 元件 | type | 主要 props |
|---|---|---|
| C-01 活動資訊列 | `event_facts` | `layout`：row／grid／card<br>`formatLabel`、`priceLabel`、`title`（card）<br>`showDate`／`showTime`／`showTimezone`／`showDuration`<br>`cardColor`、`cardTextColor`、`align: "center"` |
| C-02 講者卡 | `speaker_profiles` | `layout`：featured／grid／duo<br>`size: "small"`（featured 小頭像置中）<br>`photoShape`：portrait／square／circle<br>`columns`、`gradientFrom`／`gradientTo`<br>`items[]`：photo、alt、name、role、bio、tags（逗號分隔，最多 3 個）、href、linkLabel |
| C-03 議程 | `agenda_timeline` | `layout`：vertical／cards／steps<br>`items[]`：time、title、text、speaker、tag<br>`cardColor` |
| C-04 固定報名列 | 頁面設定 `stickyCta` | 見 §3.3 |
| C-05 首屏報名區 | `section`＋`columns2`＋`form` | 版型區塊「講座報名」有 split／stacked／overlay 三種範例（`funnel-block-library-webinar.ts`） |
| C-06 倒數 | `countdown` | `variant`：blocks／inline／bar<br>`source`：webinar_start／registration_close<br>`label`、`expiredText`、`liveText`、`replayText`<br>`numberColor`、`cellColor`、`barColor`、`barTextColor`、`align` |
| C-07 提示框 | `callout` | `tone`：info／warning／compliance<br>`title`<br>`text`（空白行分段，最多 3 段） |
| C-08 適合／不適合 | `fit_compare` | `fitTitle`、`fitItems[]`、`notFitTitle`、`notFitItems[]`（各最多 6 點）<br>`cardColor` |
| C-09 加入行事曆 | `add_to_calendar` | `googleLabel`、`icsLabel`、`pendingText`、`align` |
| C-10 公告條 | `announcement_bar`（放在 root） | `text`、`linkLabel`＋`href`、`showCountdown`、`barColor`、`barTextColor` |
| C-11 價值清單 | `value_stack` | `title`<br>`items[]`：title、text、value（文字）<br>`totalLabel`／`totalValue`、`originalPrice`、`offerLabel`、`note`<br>**純展示，不影響任何金額** |
| C-12 場次表 | `session_schedule` | `items[]`：title、text、startsAt（範本不填日期）<br>`durationMinutes`<br>狀態依日期自動計算 |
| C-13 評價輪播 | `testimonial_wall` | `layout`：marquee／carousel／grid<br>`columns`（grid）<br>items 的 title 或 text 要含「範本示意」 |
| C-14 截止提示 | `deadline_notice` | `label`、`closedText`<br>沒有伺服器截止時間時，公開頁不顯示 |
| C-15 依狀態切換 | `webinar_state`＋子 `content_box` | 每個內容盒設 `props.webinarState`：upcoming／live／replay／ended<br>不設的內容盒在所有狀態都顯示 |
| C-16 裝置框 | `media_frame` | `frame`：browser／phone／laptop<br>`src`、`alt`、`url`、`aspect` |
| C-17 作品集圖庫 | `image_gallery` | `layout`：masonry／grid<br>`columns`<br>`items[]`：src、alt、caption |
| C-18 程式碼片段 | `code_snippet` | `code`、`language`、`filename`、`showLineNumbers`、`showCopy` |
| C-19 報名表單 | `form(id, { fields, submitLabel, submitStyle, title, consent, note, style, htmlId })` | 欄位 `name` 要對應報名表的 key：`name`、`email`、`phone`<br>公開頁的欄位類型與必填以伺服器報名表為準；頁面提供標籤、提示文字（`placeholder`、`helpText`）、半寬（`half`，手機一律整列）、送出按鈕樣式、同意文字與小字 |

既有的展示元件也都可以用：`section_title`、`icon_list`、`stats`、`logo_strip`、`image_cards`、`content_cards`、`video_gallery`、`nav_bar`、`shape_divider`、`faq`。它們的 props 見 `src/lib/funnel-element-inspector.ts` 的屬性面板定義。

### 3.6 文案與素材

- 評價、Logo、數據都要標示「範本示意」（常數 `WEBINAR_TEMPLATE_SAMPLE_MARK`），或用明顯的佔位文字（例如「學員 A｜職稱」）。
- 圖片放在 `public/funnel-illustrations/webinar/NN/`，或使用 `/placeholder.svg`。
  - SVG 必須有 viewBox，且 ≤ 60KB。
  - hero 圖片 ≤ 200KB。
- 不使用 `raw_html`，也不使用外部圖片網址。
- 對比：
  - 小字至少 4.5:1。
  - 金、亮黃、螢光綠只能放在深色底，或只用在 ≥ 24px 的大字。
  - 每份 spec 的配色表已經算好對比。

## 4. 「不跑版」QA 腳本

```bash
npm run qa:template-layout -- --templates=webinar-ai-minimal --stress --out=artifacts/funnel-template-qa/01
```

- 不帶 `--base-url` 時：
  - 腳本把 `src`、`public` 複製到暫存鏡像目錄（不含 `.env*`）。
  - 在 127.0.0.1 啟動 `next dev`，跑完自動關閉。
  - 第一次編譯約需 1–2 分鐘。
- 已經在本機跑 dev server 時，可以加 `--base-url=http://127.0.0.1:3000`。
- 寬度：
  - 預設檢查 1440、1280、1024、768、390、375、360，另加 375×667 首屏檢查。
  - 320 只做降級檢查（L-1、L-3、L-5、L-11）。
  - `--widths=1440,390` 可以只跑部分寬度。
- `--stress`：同一頁再用壓力文案跑一次（qa-standards §4）。
- `--all`：跑範本庫全部範本，包含隱藏範本。
- 輸出：
  - `<out>/<id>@<width>[-stress].png` 是全頁截圖。
  - `<out>/report.json` 是完整報告。
  - 主控台列出每個失敗的規則、節點 id（`data-funnel-node-id`）與細節。
  - 有失敗時 exit code 為 1。
- 頁面入口是 development-only 的 harness：`/browser-qa/funnel-design?template=<id>&viewport=responsive[&stress=1]`。
  - 它直接渲染公開頁元件 `PublicFunnelDocument`，由 matchMedia 自行判斷手機、平板或桌機。
  - 報名表單用合成的姓名、Email、電話欄位，只顯示、不送出。
- 腳本沒有涵蓋、需要人工確認：
  - L-8 固定列不遮內容
  - L-9 CLS
  - 標題孤字與行數（§3.2）
  - axe 對比複查
- `artifacts/funnel-template-qa/` 已在 `.gitignore`，不要 commit 截圖。截圖放在不合併的 `*-screenshots` 分支，PR 描述附上連結。

### 基準

2026-10-28 用現有範本跑出的基準（一般文案），失敗是既有問題，不需要在範本工作階段修：

- `custom-luxury-course`：
  - 768 與 1024 有 L-10 欄寬不足。
  - 手機有 F-3.1 小於 14px 的日期與標籤。
  - 375×667 首屏看不到 CTA。
  - 壓力文案下，評價牆的 `line-clamp` 被判為 L-3。
- `webinar-registration`：
  - 768 有 L-10。
  - 360 的輸入框寬 274px，低於 280px（L-11）。
- `webinar-course-registration`：手機主要 CTA 高 46px，低於 48px（L-5）。

## 5. 命名與標籤

- 範本 id：`webinar-<slug>`，與 spec 的「範本 id」相同；檔名 `NN-<slug>.ts`。
- `name`：範本庫顯示名稱。
- `category`：產業或用途的短分類，例如「理財講座」。
- 用途標籤 `purposes` 只能用 `funnel-template-catalog.ts` 的值：
  - `webinar`：每個範本都要有。
  - `sales`：長篇銷講、價值錨定類，依 spec 的「範本庫標籤」。
  - 其他值：`leads`、`brand`、`policy`。
- 風格標籤 `styles` 只能用：
  - `minimal`：簡約
  - `warm`：溫暖
  - `natural`：自然
  - `professional`：專業
  - `vivid`：活潑
  - `luxe`：高質感
- 範本庫可以依用途與風格篩選，所以標籤要照 spec 填，不要自創新值。新增標籤值屬於契約變更，交給主對話處理。

## 6. 完成標準（貼在工作階段回報）

- [ ] `NN-<slug>.ts` 已從 `null` 換成範本定義，`NN-<slug>.test.ts` 與快照已建立。
- [ ] `npx vitest run src/lib/funnel-templates/webinar` 通過，`webinarTemplateIssues` 為空。
- [ ] QA 腳本：7 種寬度加上壓力文案，L-1～L-11 都通過，320 的降級檢查也通過。附上 `report.json` 摘要與 1440／390 截圖。
- [ ] 375×667 首屏看得到報名表單的第一個欄位或主要 CTA；捲過首屏後出現固定報名列。
- [ ] 日期全部來自動態欄位或元件；沒有假名額、假倒數。
- [ ] `npm run typecheck`、`npm run lint` 通過。
- [ ] 沒有修改範本檔以外的任何檔案。如果需要修改，已在共用筆記說明原因並交給主對話。
