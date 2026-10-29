# sales-07｜低價入門商品頁

| 項目 | 內容 |
|---|---|
| 範本 id | `sales-tripwire-mealprep`（感謝頁 `sales-tripwire-mealprep-thanks`） |
| 原型 | 銷售 7：低價入門（tripwire） |
| 結構參考 | S9（見 `../research.md` §2） |
| 範本庫標籤 | 用途 `sales`、風格 `vivid` |

## 1. 定位

- 低價入門商品：讓新名單完成第一次購買。
- 虛構主題：「一週備餐食譜包」；作者曾小米｜營養師（虛構）

## 2. 區塊順序

| # | 區塊 | 元件 | 手機 |
|---|---|---|---|
| 1 | 首屏：H1、報價卡、截止提示 | `columns2` | 報價卡在 H1 後 |
| 2 | 包含內容 | `icon_list` | — |
| 3 | 菜色預覽 | `image_cards` | — |
| 4 | 作者 | `speaker_profiles` small | — |
| 5 | 評價＋FAQ＋報價卡 | `testimonial_wall`、`faq`、報價卡 | — |
| — | 手機固定行動列 | `settings.stickyCta`（捲到表單／報價卡） | 出現 |

## 3. 配色

| Token | Hex | 用途 |
|---|---|---|
| bg | `#fff8f1` | 頁面 |
| ink | `#2a1a10` | 標題 |
| body | `#4d3a2e` | 內文 |
| primary | `#b93d17` | 按鈕（白字） |
| green | `#2f7a3f` | 強調 |
| card | `#ffffff` | 卡片 |

對比以共用檢查（`findFunnelContrastIssues`，AA 4.5:1）為準；淺色強調色只用在大字或深色底。

## 4. 字型

- 全頁 `sans-tc`。

## 5. 原創文案大綱

- H1：一個週末備好 5 天午晚餐
- 截止提示：由營運設定的截止時間（沒有就不顯示）

## 6. 圖片

- 菜色插畫 4 張，放在 `public/funnel-illustrations/sales/07/`，SVG 要有 viewBox、≤ 60KB。

## 7. 感謝頁

- 同色；卡片「下載食譜包」；三步驟：收確認信、下載、週末備餐；下一步：完整 4 週備餐課。

## 8. 驗收重點

- 不寫死倒數或名額。
- 共用檢查（`conversionTemplateIssues`）為空；不跑版 QA 1440／1280／1024／768／390／360＋壓力文案通過。
