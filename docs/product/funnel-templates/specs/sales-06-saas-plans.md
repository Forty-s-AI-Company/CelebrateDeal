# sales-06｜訂閱方案銷售頁

| 項目 | 內容 |
|---|---|
| 範本 id | `sales-saas-plans`（感謝頁 `sales-saas-plans-thanks`） |
| 原型 | 銷售 6：訂閱方案頁 |
| 結構參考 | S4、S8（見 `../research.md` §2） |
| 範本庫標籤 | 用途 `sales`、風格 `professional` |

## 1. 定位

- 軟體、會員、內容訂閱；以方案與功能決策。
- 虛構主題：「班表通」小店排班 App 年訂閱（虛構）

## 2. 區塊順序

| # | 區塊 | 元件 | 手機 |
|---|---|---|---|
| 1 | 首屏：H1、副標、手機框 App 畫面、CTA | `columns2` | — |
| 2 | Logo 牆（範本示意） | `logo_strip` | — |
| 3 | 3 大功能 | `content_cards` 3 | — |
| 4 | 方案內容＋報價卡 | `value_stack`＋報價卡 | — |
| 5 | 評價 | `testimonial_wall` | — |
| 6 | FAQ | `faq` | — |
| — | 手機固定行動列 | `settings.stickyCta`（捲到表單／報價卡） | 出現 |

## 3. 配色

| Token | Hex | 用途 |
|---|---|---|
| bg | `#f6f8fc` | 頁面 |
| ink | `#0d1b2a` | 標題 |
| body | `#3c4a5c` | 內文 |
| primary | `#3b5bdb` | 按鈕（白字） |
| mint | `#0f7a5f` | 強調 |
| card | `#ffffff` | 卡片 |

對比以共用檢查（`findFunnelContrastIssues`，AA 4.5:1）為準；淺色強調色只用在大字或深色底。

## 4. 字型

- 全頁 `sans-tc`。

## 5. 原創文案大綱

- H1：排班 10 分鐘搞定，換班不用再一直傳訊息

## 6. 圖片

- 手機框 App 畫面、3 張功能圖、Logo，放在 `public/funnel-illustrations/sales/06/`，SVG 要有 viewBox、≤ 60KB。

## 7. 感謝頁

- 同色；卡片「下載 App 並登入」；三步驟：收確認信、下載 App、邀請員工。

## 8. 驗收重點

- 方案內的金額標示範本示意，實際售價看報價卡。
- 共用檢查（`conversionTemplateIssues`）為空；不跑版 QA 1440／1280／1024／768／390／360＋壓力文案通過。
