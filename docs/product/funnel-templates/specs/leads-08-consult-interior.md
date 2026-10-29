# leads-08｜免費諮詢預約頁

| 項目 | 內容 |
|---|---|
| 範本 id | `leads-consult-interior`（感謝頁 `leads-consult-interior-thanks`） |
| 原型 | 名單 8：免費諮詢／估價申請 |
| 結構參考 | L12、S8（見 `../research.md` §2） |
| 範本庫標籤 | 用途 `leads`、風格 `professional` |

## 1. 定位

- 在地服務業：設計、裝修、顧問、保險；名單＝諮詢意願。
- 虛構主題：「老屋翻新 免費丈量與初步估價」；森居設計（虛構）

## 2. 區塊順序

| # | 區塊 | 元件 | 手機 |
|---|---|---|---|
| 1 | 首屏：左 H1＋3 點＋信任列，右表單卡（姓名、手機、Email） | `columns2` 7:5，手機反轉 | 表單在前 |
| 2 | 數據（範本示意） | `stats` | 2×2 |
| 3 | 服務流程 5 步 | `agenda_timeline` steps | 單欄 |
| 4 | 作品 | `image_gallery` masonry | — |
| 5 | 客戶回饋 | `testimonial_wall` carousel | — |
| 6 | 合作須知 | `callout` info | — |
| 7 | FAQ＋第二次表單 | `faq`、`form` | — |
| — | 手機固定行動列 | `settings.stickyCta`（捲到表單／報價卡） | 出現 |

## 3. 配色

| Token | Hex | 用途 |
|---|---|---|
| bg | `#f7f6f3` | 頁面 |
| ink | `#1d2422` | 標題 |
| body | `#424a47` | 內文 |
| primary | `#2c4a3f` | 按鈕（白字） |
| oak | `#8a5a24` | 強調 |
| card | `#ffffff` | 卡片 |

對比以共用檢查（`findFunnelContrastIssues`，AA 4.5:1）為準；淺色強調色只用在大字或深色底。

## 4. 字型

- 全頁 `sans-tc`。

## 5. 原創文案大綱

- eyebrow：老屋翻新｜免費到府丈量
- H1：先丈量、再估價，翻新預算不再一直追加
- 按鈕：預約免費丈量
- 小字：送出後 2 個工作天內由設計師聯繫。

## 6. 圖片

- 空間線稿 SVG 4–5 張，放在 `public/funnel-illustrations/leads/08/`，SVG 要有 viewBox、≤ 60KB。

## 7. 感謝頁

- 同色；資源卡「我們收到你的預約」；三步驟：2 個工作天內聯繫、準備平面圖或照片、約丈量時間。

## 8. 驗收重點

- 表單在 360 寬可用（L-11）。
- 共用檢查（`conversionTemplateIssues`）為空；不跑版 QA 1440／1280／1024／768／390／360＋壓力文案通過。
