# sales-02｜短版數位商品頁

| 項目 | 內容 |
|---|---|
| 範本 id | `sales-digital-planner`（感謝頁 `sales-digital-planner-thanks`） |
| 原型 | 銷售 2：短版數位商品 |
| 結構參考 | S4、S8、L5（見 `../research.md` §2） |
| 範本庫標籤 | 用途 `sales`、風格 `minimal` |

## 1. 定位

- 電子模板、電子書、素材包等單純的數位商品；熟客與社群流量。
- 虛構主題：「質感數位手帳模板組」；品牌紙上日常（虛構）

## 2. 區塊順序

| # | 區塊 | 元件 | 手機 |
|---|---|---|---|
| 1 | 首屏：左平板框預覽，右 H1、3 點、報價卡（首屏就能買） | `columns2` 1:1，平板堆疊 | 預覽在上 |
| 2 | 包含內容 | `icon_list` grid 3 | 單欄 |
| 3 | 內頁預覽 | `image_gallery` grid 3 | 單欄 |
| 4 | 使用者回饋 | `testimonial_wall` carousel | — |
| 5 | FAQ＋報價卡 | `faq`、`conversionOfferCard` | — |
| — | 手機固定行動列 | `settings.stickyCta`（捲到表單／報價卡） | 出現 |

## 3. 配色

| Token | Hex | 用途 |
|---|---|---|
| bg | `#ffffff` | 頁面 |
| soft | `#f4f1ee` | 次要區塊 |
| ink | `#1c1b1a` | 標題 |
| body | `#4a4744` | 內文 |
| primary | `#1c1b1a` | 按鈕（白字） |
| accent | `#a64a32` | 小字強調 |

對比以共用檢查（`findFunnelContrastIssues`，AA 4.5:1）為準；淺色強調色只用在大字或深色底。

## 4. 字型

- 全頁 `sans-tc`。

## 5. 原創文案大綱

- H1：一本就夠的數位手帳：年、月、週、日一次排好
- 3 點：超連結分頁、12 種封面、免費更新（請依實際內容修改）

## 6. 圖片

- 平板框手帳預覽、3 張內頁，放在 `public/funnel-illustrations/sales/02/`，SVG 要有 viewBox、≤ 60KB。

## 7. 感謝頁

- 白底；卡片「下載說明」；三步驟：收付款確認信、下載檔案、匯入 App；FAQ：裝置相容、發票、數位商品退款。

## 8. 驗收重點

- 首屏同時看得到標題與報價卡（1440）。
- 共用檢查（`conversionTemplateIssues`）為空；不跑版 QA 1440／1280／1024／768／390／360＋壓力文案通過。
