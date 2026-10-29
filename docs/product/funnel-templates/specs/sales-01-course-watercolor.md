# sales-01｜長篇課程銷售頁

| 項目 | 內容 |
|---|---|
| 範本 id | `sales-course-watercolor`（感謝頁 `sales-course-watercolor-thanks`） |
| 原型 | 銷售 1：長篇課程銷售信 |
| 結構參考 | S1、S2、S3、S5、S6、C2（見 `../research.md` §2） |
| 範本庫標籤 | 用途 `sales`、風格 `warm` |

## 1. 定位

- 線上課程、陪伴型課程；冷流量與較高客單需要完整說服。
- 虛構主題：「零基礎水彩 8 週線上課」；老師蘇映晴（虛構）

## 2. 區塊順序

| # | 區塊 | 元件 | 手機 |
|---|---|---|---|
| 1 | 首屏：水彩暈染背景、H1、副標、作品拼貼、CTA → #offer | `columns2` 1:1 | — |
| 2 | 你是不是也這樣 | `icon_list` 2 欄 | 單欄 |
| 3 | 老師的故事 | `speaker_profiles` featured＋`stats` | — |
| 4 | 8 週課綱 | `agenda_timeline` vertical | — |
| 5 | 學員作品 | `image_gallery` masonry（範本示意） | — |
| 6 | 學員回饋 | `testimonial_wall` grid | — |
| 7 | 你會得到＋報價卡 | `value_stack`（範本示意）＋`conversionOfferCard` | 上下 |
| 8 | 安心保證 | `callout` info | — |
| 9 | FAQ＋最後 CTA | `faq`、`button` | — |
| — | 手機固定行動列 | `settings.stickyCta`（捲到表單／報價卡） | 出現 |

## 3. 配色

| Token | Hex | 用途 |
|---|---|---|
| bg | `#fbf7f2` | 紙底 |
| ink | `#2b2330` | 標題 |
| body | `#4b4350` | 內文 |
| primary | `#8f3b5c` | 按鈕（白字） |
| blue | `#2f5f8a` | 次強調 |
| card | `#ffffff` | 卡片 |

對比以共用檢查（`findFunnelContrastIssues`，AA 4.5:1）為準；淺色強調色只用在大字或深色底。

## 4. 字型

- 標題 `wenkai-tc`，內文 `sans-tc`。

## 5. 原創文案大綱

- H1：8 週，從不敢下筆到畫完一本水彩小冊
- CTA：查看課程方案
- 保證：退費條件寫在 callout，提醒商家依實際政策修改

## 6. 圖片

- 水彩暈染背景、作品 SVG 5–6 張，放在 `public/funnel-illustrations/sales/01/`，SVG 要有 viewBox、≤ 60KB。

## 7. 感謝頁

- 紙底＋酒紅；卡片「課程開通說明」；三步驟：收付款確認信、登入課程、加入學員社群；FAQ：發票、退費、聯絡。

## 8. 驗收重點

- 報價卡是淺色白卡（結帳元件字色固定深色）。
- 共用檢查（`conversionTemplateIssues`）為空；不跑版 QA 1440／1280／1024／768／390／360＋壓力文案通過。
