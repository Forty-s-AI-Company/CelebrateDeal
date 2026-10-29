# sales-08｜服務方案銷售頁

| 項目 | 內容 |
|---|---|
| 範本 id | `sales-service-photo`（感謝頁 `sales-service-photo-thanks`） |
| 原型 | 銷售 8：服務方案頁 |
| 結構參考 | S8、S4（見 `../research.md` §2） |
| 範本庫標籤 | 用途 `sales`、風格 `minimal` |

## 1. 定位

- 攝影、設計、婚禮、顧問等服務方案。
- 虛構主題：「家庭寫真到府拍攝方案」；工作室光室（虛構）

## 2. 區塊順序

| # | 區塊 | 元件 | 手機 |
|---|---|---|---|
| 1 | 首屏：大幅作品、H1、CTA | `columns2` | — |
| 2 | 作品集 | `image_gallery` masonry | — |
| 3 | 方案內容 | `icon_list` | — |
| 4 | 拍攝流程 | `agenda_timeline` steps | — |
| 5 | 評價 | `testimonial_wall` | — |
| 6 | 報價卡＋合作須知 | 報價卡、`callout` | — |
| 7 | FAQ | `faq` | — |
| — | 手機固定行動列 | `settings.stickyCta`（捲到表單／報價卡） | 出現 |

## 3. 配色

| Token | Hex | 用途 |
|---|---|---|
| bg | `#ffffff` | 頁面 |
| ink | `#151515` | 標題 |
| body | `#444444` | 內文 |
| primary | `#151515` | 按鈕（白字） |
| sand | `#efe9e1` | 次要區塊 |
| accent | `#7d5d3f` | 小字強調 |

對比以共用檢查（`findFunnelContrastIssues`，AA 4.5:1）為準；淺色強調色只用在大字或深色底。

## 4. 字型

- 標題 `serif-tc`，內文 `sans-tc`。

## 5. 原創文案大綱

- H1：在家裡最自在的角落，留下你們現在的樣子

## 6. 圖片

- 作品 SVG 5–6 張，放在 `public/funnel-illustrations/sales/08/`，SVG 要有 viewBox、≤ 60KB。

## 7. 感謝頁

- 白底；卡片「預約拍攝日期」；三步驟：收確認信、填寫拍攝問卷、確認日期。

## 8. 驗收重點

- 作品圖比例不變形（L-6）。
- 共用檢查（`conversionTemplateIssues`）為空；不跑版 QA 1440／1280／1024／768／390／360＋壓力文案通過。
