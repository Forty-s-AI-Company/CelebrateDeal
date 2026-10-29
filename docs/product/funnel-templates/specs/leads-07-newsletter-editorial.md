# leads-07｜電子報訂閱頁（編輯感）

| 項目 | 內容 |
|---|---|
| 範本 id | `leads-newsletter-editorial`（感謝頁 `leads-newsletter-editorial-thanks`） |
| 原型 | 名單 7：電子報訂閱 |
| 結構參考 | L3、L4、T2、T3（見 `../research.md` §2） |
| 範本庫標籤 | 用途 `leads`、風格 `natural` |

## 1. 定位

- 寫作者、地方媒體、品牌內容；長期關係型名單。
- 虛構主題：「週日慢讀｜城市散步電子報」；主編何以寧（虛構）

## 2. 區塊順序

| # | 區塊 | 元件 | 手機 |
|---|---|---|---|
| 1 | 首屏：報頭大標、發刊頻率、Email 表單 | 單欄置中 | — |
| 2 | 每期你會收到 | `icon_list` grid 3 | 單欄 |
| 3 | 過往三期 | `content_cards` 3 欄（插圖） | 單欄 |
| 4 | 主編的話 | `speaker_profiles` featured | — |
| 5 | 讀者回饋 | `testimonial_wall` grid（範本示意） | — |
| 6 | 第二次表單 | `form` | — |
| — | 手機固定行動列 | `settings.stickyCta`（捲到表單／報價卡） | 出現 |

## 3. 配色

| Token | Hex | 用途 |
|---|---|---|
| paper | `#f6f2ea` | 紙張底 |
| ink | `#1f1d1a` | 標題 |
| body | `#45413a` | 內文 |
| green | `#2f5d46` | 按鈕（白字） |
| rule | `#d9d1c2` | 細線 |
| card | `#fffdf8` | 卡片 |

對比以共用檢查（`findFunnelContrastIssues`，AA 4.5:1）為準；淺色強調色只用在大字或深色底。

## 4. 字型

- 標題 `serif-tc`，內文 `sans-tc`。

## 5. 原創文案大綱

- eyebrow：每週日早上寄出・免費
- H1：週日慢讀：一封帶你走進城市巷弄的信
- 按鈕：免費訂閱

## 6. 圖片

- 3 張巷弄線稿插圖，放在 `public/funnel-illustrations/leads/07/`，SVG 要有 viewBox、≤ 60KB。

## 7. 感謝頁

- 紙張底；資源卡「確認信已寄出」，提醒點擊確認連結（雙重確認）；三步驟：收信確認、加入通訊錄、回信告訴我們你住哪個城市。

## 8. 驗收重點

- 報頭大字在 360 寬不溢出。
- 共用檢查（`conversionTemplateIssues`）為空；不跑版 QA 1440／1280／1024／768／390／360＋壓力文案通過。
