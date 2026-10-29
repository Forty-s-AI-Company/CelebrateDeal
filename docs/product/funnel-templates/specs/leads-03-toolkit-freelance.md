# leads-03｜範本工具包名單頁

| 項目 | 內容 |
|---|---|
| 範本 id | `leads-toolkit-freelance`（感謝頁 `leads-toolkit-freelance-thanks`） |
| 原型 | 名單 3：範本／工具包預覽 |
| 結構參考 | L1、L2、L5（見 `../research.md` §2） |
| 範本庫標籤 | 用途 `leads`、風格 `professional` |

## 1. 定位

- 工具、範本、試算表型的資源；B2B 與接案族群。
- 虛構主題：「自由接案報價單＋合約範本包」；作者鄭以安｜接案教練（虛構）

## 2. 區塊順序

| # | 區塊 | 元件 | 手機 |
|---|---|---|---|
| 1 | 首屏：深藍底，左 H1＋說明＋表單卡，右瀏覽器框預覽（報價單畫面） | `columns2` 1:1，平板堆疊 | 預覽放表單下方 |
| 2 | 工具包內容：4 個檔案 | `content_cards` 4 欄（縮圖） | 單欄 |
| 3 | 3 步驟使用 | `icon_list` numbered 3 欄 | 單欄 |
| 4 | 使用者回饋 | `testimonial_wall` carousel（範本示意） | — |
| 5 | FAQ＋第二次表單（深藍收尾） | `faq`、`form` | — |
| — | 手機固定行動列 | `settings.stickyCta`（捲到表單／報價卡） | 出現 |

## 3. 配色

| Token | Hex | 用途 |
|---|---|---|
| navy | `#0f1e36` | 首屏與收尾帶 |
| navyBody | `#c7d2e3` | 深藍內文 |
| bg | `#f5f7fb` | 頁面 |
| body | `#3a4559` | 內文 |
| primary | `#1f4fd6` | 按鈕（白字） |
| teal | `#5ad1c3` | 深色底點綴 |
| card | `#ffffff` | 卡片 |

對比以共用檢查（`findFunnelContrastIssues`，AA 4.5:1）為準；淺色強調色只用在大字或深色底。

## 4. 字型

- 全頁 `sans-tc`。

## 5. 原創文案大綱

- eyebrow：免費範本包｜Google 試算表＋Word
- H1：報價、合約、請款，一次備齊的接案範本包
- 按鈕：免費下載範本包

## 6. 圖片

- 瀏覽器框報價單畫面 SVG、4 張檔案縮圖 SVG，放在 `public/funnel-illustrations/leads/03/`，SVG 要有 viewBox、≤ 60KB。

## 7. 感謝頁

- 淺底白卡＋深藍頁尾；資源卡「開啟範本包」；下一步：接案定價工作坊（付費）。

## 8. 驗收重點

- 裝置框在 360 寬不撐出水平捲動。
- 共用檢查（`conversionTemplateIssues`）為空；不跑版 QA 1440／1280／1024／768／390／360＋壓力文案通過。
