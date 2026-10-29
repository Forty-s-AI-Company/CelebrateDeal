# sales-03｜高價陪跑方案頁（黑金）

| 項目 | 內容 |
|---|---|
| 範本 id | `sales-coaching-luxe`（感謝頁 `sales-coaching-luxe-thanks`） |
| 原型 | 銷售 3：高價陪跑／顧問 |
| 結構參考 | S5、S6、S12（見 `../research.md` §2） |
| 範本庫標籤 | 用途 `sales`、風格 `luxe` |

## 1. 定位

- 高價一對一或小班陪跑、顧問方案。
- 虛構主題：「12 週個人品牌陪跑計畫」；顧問沈亦凡（虛構）

## 2. 區塊順序

| # | 區塊 | 元件 | 手機 |
|---|---|---|---|
| 1 | 首屏：黑底金線、H1、副標、CTA | 單欄置中 | — |
| 2 | 12 週後你會擁有 | `icon_list` grid 2×2 | 單欄 |
| 3 | 適合／不適合 | `fit_compare` | 上下 |
| 4 | 陪跑流程 | `agenda_timeline` steps | — |
| 5 | 顧問介紹 | `speaker_profiles` featured＋`stats` | — |
| 6 | 學員案例 | `content_cards` 3（範本示意） | — |
| 7 | 方案內容＋報價卡 | `value_stack`＋白色報價卡 | — |
| 8 | FAQ | `faq` | — |
| — | 手機固定行動列 | `settings.stickyCta`（捲到表單／報價卡） | 出現 |

## 3. 配色

| Token | Hex | 用途 |
|---|---|---|
| black | `#0c0c0d` | 主底 |
| charcoal | `#17171a` | 次底 |
| ink | `#f5f1e8` | 標題 |
| body | `#cfc8bb` | 內文 |
| gold | `#c9a063` | 點綴與按鈕（深字） |
| card | `#ffffff` | 報價卡 |

對比以共用檢查（`findFunnelContrastIssues`，AA 4.5:1）為準；淺色強調色只用在大字或深色底。

## 4. 字型

- 標題 `serif-tc`，內文 `sans-tc`。

## 5. 原創文案大綱

- H1：12 週，把你的專業變成一個被記得的品牌
- CTA：查看陪跑方案

## 6. 圖片

- 金線抽象 SVG，放在 `public/funnel-illustrations/sales/03/`，SVG 要有 viewBox、≤ 60KB。

## 7. 感謝頁

- 黑底金線；卡片「預約第一次會談」；三步驟：收確認信、填寫課前問卷、預約第一次會談。

## 8. 驗收重點

- 報價卡白底，結帳元件深字。
- 共用檢查（`conversionTemplateIssues`）為空；不跑版 QA 1440／1280／1024／768／390／360＋壓力文案通過。
