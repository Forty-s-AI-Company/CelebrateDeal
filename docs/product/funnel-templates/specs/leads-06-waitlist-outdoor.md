# leads-06｜新品候補名單頁（深色）

| 項目 | 內容 |
|---|---|
| 範本 id | `leads-waitlist-outdoor`（感謝頁 `leads-waitlist-outdoor-thanks`） |
| 原型 | 名單 6：新品候補／搶先名單 |
| 結構參考 | L8、L9（見 `../research.md` §2） |
| 範本庫標籤 | 用途 `leads`、風格 `luxe` |

## 1. 定位

- 實體或數位新品上市前收集候補；品牌型商家。
- 虛構主題：「霧嶺 28L 山系通勤背包」候補名單；品牌霧嶺 Ridge & Fog（虛構）

## 2. 區塊順序

| # | 區塊 | 元件 | 手機 |
|---|---|---|---|
| 1 | 首屏：深墨綠，產品線稿 SVG、H1、說明、Email 表單 | 單欄置中 | — |
| 2 | 4 個設計重點 | `icon_list` grid 2×2 | 單欄 |
| 3 | 細節特寫 | `image_gallery` grid 3 | 單欄 |
| 4 | 上市流程（不寫日期） | `agenda_timeline` steps | — |
| 5 | 候補權益與 FAQ | `icon_list`＋`faq` | — |
| 6 | 第二次表單 | `form` | — |
| — | 手機固定行動列 | `settings.stickyCta`（捲到表單／報價卡） | 出現 |

## 3. 配色

| Token | Hex | 用途 |
|---|---|---|
| forest | `#0f1714` | 主底 |
| forestBody | `#c8d3cc` | 深色內文 |
| ink | `#f3f1ea` | 深色標題 |
| brass | `#c9a46a` | 點綴與按鈕（深字） |
| card | `#18221e` | 卡片 |

對比以共用檢查（`findFunnelContrastIssues`，AA 4.5:1）為準；淺色強調色只用在大字或深色底。

## 4. 字型

- 標題 `serif-tc`，內文 `sans-tc`。

## 5. 原創文案大綱

- eyebrow：候補名單開放中
- H1：為城市與山路之間而做的 28L 背包
- 說明：加入候補，開賣時優先收到通知與首批配色資訊。
- 按鈕：加入候補名單（不寫人數、不寫剩餘數量）

## 6. 圖片

- 背包線稿 SVG（深底金線）、3 張細節特寫，放在 `public/funnel-illustrations/leads/06/`，SVG 要有 viewBox、≤ 60KB。

## 7. 感謝頁

- 深墨綠；資源卡「你已在候補名單上」；三步驟：收信確認、追蹤品牌、開賣時收到優先通知。

## 8. 驗收重點

- 深底上的金色字 ≥ 4.5。
- 共用檢查（`conversionTemplateIssues`）為空；不跑版 QA 1440／1280／1024／768／390／360＋壓力文案通過。
