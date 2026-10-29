# sales-05｜預購銷售頁

| 項目 | 內容 |
|---|---|
| 範本 id | `sales-presale-picturebook`（感謝頁 `sales-presale-picturebook-thanks`） |
| 原型 | 銷售 5：預購／募資型 |
| 結構參考 | S10、S11、C1（見 `../research.md` §2） |
| 範本庫標籤 | 用途 `sales`、風格 `vivid` |

## 1. 定位

- 出版、文創、商品預購；先收款後製作。
- 虛構主題：《島嶼原生植物小圖鑑》繪本預購；作者葉小森（虛構）

## 2. 區塊順序

| # | 區塊 | 元件 | 手機 |
|---|---|---|---|
| 1 | 首屏：明亮插畫、H1、預購狀態、CTA | `columns2` | — |
| 2 | 內頁預覽 | `image_gallery` grid | — |
| 3 | 製作流程（不寫日期） | `agenda_timeline` steps | — |
| 4 | 預購權益 | `icon_list` | — |
| 5 | 作者 | `speaker_profiles` | — |
| 6 | 報價卡＋截止提示 | 報價卡、`deadline_notice` | — |
| 7 | 預購須知（交付、延遲、退款） | `callout` warning | — |
| 8 | FAQ | `faq` | — |
| — | 手機固定行動列 | `settings.stickyCta`（捲到表單／報價卡） | 出現 |

## 3. 配色

| Token | Hex | 用途 |
|---|---|---|
| bg | `#fffdf6` | 頁面 |
| ink | `#1f2a1c` | 標題 |
| body | `#3e4a3a` | 內文 |
| primary | `#2e7d4f` | 按鈕（白字） |
| coral | `#c0412b` | 強調 |
| sun | `#ffcf5c` | 大色塊（深字） |

對比以共用檢查（`findFunnelContrastIssues`，AA 4.5:1）為準；淺色強調色只用在大字或深色底。

## 4. 字型

- 標題 `wenkai-tc`，內文 `sans-tc`。

## 5. 原創文案大綱

- H1：把島上的原生植物，畫進一本給孩子的圖鑑
- 預購須知：預計交付方式、延遲時的通知方式、退款條件

## 6. 圖片

- 植物插畫，放在 `public/funnel-illustrations/sales/05/`，SVG 要有 viewBox、≤ 60KB。

## 7. 感謝頁

- 同色；卡片「預購成功，製作進度會寄到信箱」；三步驟：確認信、製作進度通知、出貨。

## 8. 驗收重點

- 不得顯示假的募資進度或人數。
- 共用檢查（`conversionTemplateIssues`）為空；不跑版 QA 1440／1280／1024／768／390／360＋壓力文案通過。
