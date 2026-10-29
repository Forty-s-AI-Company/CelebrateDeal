# 實作名單頁與銷售頁範本

> 對象：實作 `specs/leads-01～08`、`specs/sales-01～08` 的人。
> 元件、字型、版面與 QA 腳本都沿用 Webinar 範本（`../webinar-templates/IMPLEMENTING.md` §3、§4），這份文件只寫不同的地方。
> 範本只寫資料，不改渲染器、元件或 PageDocument 契約；缺能力時寫進筆記交給整合者。

## 1. 檔案

| 檔案 | 用途 |
|---|---|
| `src/lib/funnel-templates/leads/NN-<slug>.ts`、`sales/NN-<slug>.ts` | 範本定義（含感謝頁設計 `thankYou`）。未完成前是 `null`，`index.ts` 已經 import |
| 同名 `.test.ts` | 複製 `leads/01-checklist-minimal.test.ts` |
| `__snapshots__/NN-<slug>.test.ts.snap` | 主頁與感謝頁的節點 id 快照 |
| `public/funnel-illustrations/leads/NN/*.svg`、`sales/NN/*.svg` | 原創插圖（有 viewBox、≤ 60KB） |
| `src/lib/funnel-templates/conversion/` | 共用：型別、感謝頁產生器、報價卡、共用檢查（整合者維護） |

範例：`leads/01-checklist-minimal.ts`（名單頁＋名單感謝頁）、`sales/01-course-watercolor.ts`（銷售頁＋訂單感謝頁）。

## 2. 範本定義

```ts
import { conversionTemplateKit, conversionOfferCard, CONVERSION_TEMPLATE_SAMPLE_MARK, type ConversionTemplateDefinition } from "../conversion/types";

export const template: ConversionTemplateDefinition = {
  id: "leads-checklist-minimal",   // leads-<slug> 或 sales-<slug>；上線後不可改
  kind: "leads",                   // leads → 名單目標（audience），sales → 銷售目標（sell）
  number: 1,
  name, description, category,
  purposes: ["leads"],             // 必須包含 kind；可以再加 brand 等
  styles: ["minimal"],
  preview, theme,
  settings: { scrollReveal: "rise", stickyCta: { enabled: true, label: "免費下載清單", target: "optin", showDate: false, devices: "mobile_tablet", … } },
  build,
  thankYou: { … },                 // §4
};
```

- 節點一律用 `conversionTemplateKit(prefix)`（與 `webinarTemplateKit` 相同）建立；id 固定、可預測。
- 名單頁的首屏表單 `htmlId: "optin"`；銷售頁的報價卡 `htmlId: "offer"`。頁中的 CTA 用 `button(…, "#optin")`／`"#offer"`，固定行動列 `target` 指向同一個 id。
- `showDate: false`：名單頁與銷售頁沒有活動時間。不要用 `event_facts`、`{{webinar.*}}`。

## 3. 名單頁與銷售頁的規則

### 名單頁（leads）

- 至少一個 `form`，欄位 `name` 對應名單表單的 key（`name`、`email`、`phone`）。**公開頁的欄位、標籤、必填、送出文字與同意文字一律來自綁定的名單表單**；範本給的是 placeholder、helpText、樣式、標題與小字。
- 不放付款元件、不放導覽列（只有錨點按鈕）。
- 首屏在 375×667 要看到第一個欄位或送出按鈕（L-7）。

### 銷售頁（sales）

- **售價與結帳只用報價卡** `conversionOfferCard(prefix, "offer", { title, lines, note, style, titleColor, noteColor, htmlId: "offer" })`：裡面的 `offer_price`、`payment_button` 讀「訂單表單」步驟綁定的商品，範本不寫售價。
- 報價卡的節點 id 是 `<prefix>_<id>`：放報價卡的區段不要也命名成 `offer`，否則節點 id 重複、PageDocument 驗證失敗。
- 報價卡必須是**淺色底**（結帳元件的字是深色）；按鈕顏色跟隨頁面 `linkColor`，所以 `theme.typography.linkColor` 要選能當按鈕底色的顏色。
- `value_stack`、原價、方案比較等寫死的金額只做展示，**同一個節點要有「範本示意」**（`CONVERSION_TEMPLATE_SAMPLE_MARK`），共用檢查會擋。
- 一定要有 `faq`；建議有保證／退費／配送說明的 `callout`，文字提醒商家依實際政策修改。
- 急迫感：只能用 `deadline_notice`（沒有營運截止時間時不顯示）或 `countdown` 的 `source: "registration_close"`。不得寫死剩餘名額、庫存、人數（共用檢查會擋「僅剩 N 位」這類字）。
- QA harness 會替 sell 範本帶入合成商品（`範例方案（合成資料）`、NT$2,480），截圖看得到真實的價格與結帳按鈕。

## 4. 感謝頁（`thankYou`）

感謝頁由 `conversion/thank-you.ts` 產生，版型固定、顏色與文案由範本提供，id 是 `<範本 id>-thanks`：

- 名單範本 → 名單感謝頁步驟（`opt_in_thank_you_page`）的選單。
- 銷售範本 → 訂單感謝頁步驟（`thank_you_page`）的選單。
- 不出現在範本庫瀏覽（`libraryHidden`），只在感謝頁步驟出現。

| 欄位 | 說明 |
|---|---|
| `tokens` | `background`、`surface`、`ink`、`body`、`accent`、`onAccent`、`line`、`footerBackground`、`footerText`、`radius`。`ink`、`body` 對 `background` 與 `surface` 都要 ≥ 4.5；`onAccent` 對 `accent` ≥ 4.5；`accent` 對 `background` ≥ 4.5（eyebrow 小字） |
| `eyebrow`、`title`、`intro` | 首屏。名單：提醒收信、檢查垃圾郵件匣；訂單：付款完成後會收到確認信（不要寫「付款成功」，感謝頁不知道付款狀態） |
| `card` | 名單：資源名稱＋下載按鈕；訂單：購買內容與開通／出貨方式。**不寫金額** |
| `steps` | 三步驟 |
| `next` | 選填：名單 → 付費方案；訂單 → 社群或相關商品 |
| `faq` | 訂單感謝頁建議放：發票、退款、聯絡 |
| `footer` | 頁尾一句話 |

## 5. 驗收

```bash
npx vitest run src/lib/funnel-templates/leads src/lib/funnel-templates/sales
npm run qa:template-layout -- --templates=<id>,<id>-thanks --stress --widths=1440,1280,1024,768,390,360 --out=artifacts/funnel-template-qa/<kind>-NN
```

- 共用檢查 `conversionTemplateIssues` 為空：可解析、無 `raw_html`、圖片在自己的資料夾且 ≤ 60KB、無寫死日期、評價／Logo／數據／金額標示範本示意、無假名額、倒數只綁營運截止、AA 對比、字型合法、每個區段都有手機內距；名單頁有表單、沒有付款元件；銷售頁有報價卡與 FAQ；感謝頁同樣通過。
- QA 腳本 6 種寬度＋壓力文案 0 失敗。截圖要**自己看過**（全頁截圖很長，切成多張看）：首屏、表單、報價卡、手機排版、感謝頁。
- 證據：每個範本的 1440 與 390 截圖（主頁與感謝頁，JPEG）放 `docs/ai-team/evidence/funnel-templates/`。

## 6. 汰換舊範本

- 舊的 audience 6 款、sell 3 款標記 retired（`funnel-template-gallery.ts` 的 `LEGACY_CONVERSION_REPLACEMENTS`）：仍可解析與實例化，既有漏斗不壞；不再出現在步驟選單與範本庫。
- 步驟選單：名單目標的 `opt_in_page`、`inline_form`、`popup_form`、`link_in_bio` 列出 8 個名單頁；`opt_in_thank_you_page` 列出 8 個名單感謝頁。銷售目標的 `order_form` 列出 8 個銷售頁（只有這個步驟能綁商品與結帳；`sales_page`、`upsell`、`downsell` 不提供含報價卡的範本，避免訪客看到「尚未連結商品」）；`thank_you_page` 列出 8 個訂單感謝頁。
- 範本庫的用途篩選「名單」「銷售」顯示新範本（標籤來自範本自己的 `purposes`）。
