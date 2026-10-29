# sales-04｜實體商品銷售頁

| 項目 | 內容 |
|---|---|
| 範本 id | `sales-product-coffee`（感謝頁 `sales-product-coffee-thanks`） |
| 原型 | 銷售 4：實體商品頁 |
| 結構參考 | S4、S8、T4（見 `../research.md` §2） |
| 範本庫標籤 | 用途 `sales`、風格 `natural` |

## 1. 定位

- 實體商品與組合；電商與品牌小店。
- 虛構主題：「入門手沖咖啡器材組」；品牌日向焙煎（虛構）

## 2. 區塊順序

| # | 區塊 | 元件 | 手機 |
|---|---|---|---|
| 1 | 首屏：左商品主圖，右 H1、特色、報價卡 | `columns2` 1:1，平板堆疊 | 圖在上 |
| 2 | 組合內容 | `image_cards` 4 | 2 欄 |
| 3 | 特色 | `icon_list` grid 3 | 單欄 |
| 4 | 規格 | 白卡＋`icon_list` | — |
| 5 | 評價 | `testimonial_wall` grid | — |
| 6 | 配送與退換 | `callout` info | — |
| 7 | FAQ＋報價卡 | `faq`、報價卡 | — |
| — | 手機固定行動列 | `settings.stickyCta`（捲到表單／報價卡） | 出現 |

## 3. 配色

| Token | Hex | 用途 |
|---|---|---|
| bg | `#f6f3ee` | 頁面 |
| ink | `#231c16` | 標題 |
| body | `#4a4038` | 內文 |
| primary | `#5b3a24` | 按鈕（白字） |
| green | `#3f5f45` | 強調 |
| card | `#ffffff` | 卡片 |

對比以共用檢查（`findFunnelContrastIssues`，AA 4.5:1）為準；淺色強調色只用在大字或深色底。

## 4. 字型

- 標題 `serif-tc`，內文 `sans-tc`。

## 5. 原創文案大綱

- H1：在家沖一杯好咖啡，從這組 5 件器材開始
- 報價卡：入門手沖組（價格由商品提供）

## 6. 圖片

- 器材組主圖與 4 件單品，放在 `public/funnel-illustrations/sales/04/`，SVG 要有 viewBox、≤ 60KB。

## 7. 感謝頁

- 同色；卡片「出貨說明」；三步驟：收訂單確認信、備貨出貨、收到後看沖煮教學；FAQ：出貨、退換、發票。

## 8. 驗收重點

- 配送與退換只寫原則，提醒商家填入實際政策。
- 共用檢查（`conversionTemplateIssues`）為空；不跑版 QA 1440／1280／1024／768／390／360＋壓力文案通過。
