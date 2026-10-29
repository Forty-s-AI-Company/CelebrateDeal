# leads-05｜免費 Email 課程名單頁

| 項目 | 內容 |
|---|---|
| 範本 id | `leads-email-course-photo`（感謝頁 `leads-email-course-photo-thanks`） |
| 原型 | 名單 5：免費 Email 課程 |
| 結構參考 | L2、L5、S7（見 `../research.md` §2） |
| 範本庫標籤 | 用途 `leads`、風格 `vivid` |

## 1. 定位

- 教學型創作者，以系列內容建立信任，再銷售正式課程。
- 虛構主題：「7 天用手機拍出好賣的商品照」；講師柯宇辰｜商品攝影師（虛構）

## 2. 區塊順序

| # | 區塊 | 元件 | 手機 |
|---|---|---|---|
| 1 | 首屏：亮黃底＋手機拍攝插圖，H1、7 天標籤、表單卡 | `columns2` 1:1 | 表單在插圖前 |
| 2 | 7 天課表 | `agenda_timeline` cards | 單欄 |
| 3 | 試讀第 1 課重點 | 白卡＋`icon_list` | — |
| 4 | 前後對照 | `image_cards` 3 欄（範本示意） | 單欄 |
| 5 | 講師 | `speaker_profiles` featured | — |
| 6 | FAQ＋第二次表單 | `faq`、`form` | — |
| — | 手機固定行動列 | `settings.stickyCta`（捲到表單／報價卡） | 出現 |

## 3. 配色

| Token | Hex | 用途 |
|---|---|---|
| sun | `#ffd84d` | 首屏亮黃（只放深字） |
| ink | `#1a1a1a` | 標題 |
| body | `#333333` | 內文 |
| bg | `#ffffff` | 頁面 |
| band | `#fff6d6` | 次要區塊 |
| primary | `#1a1a1a` | 按鈕（白字） |
| pink | `#c42a5f` | 強調 |

對比以共用檢查（`findFunnelContrastIssues`，AA 4.5:1）為準；淺色強調色只用在大字或深色底。

## 4. 字型

- 全頁 `sans-tc`。

## 5. 原創文案大綱

- eyebrow：免費 Email 課｜每天一封、連續 7 天
- H1：7 天，用手機拍出好賣的商品照
- 按鈕：免費開始第 1 天

## 6. 圖片

- 手機拍攝插圖、3 組前後對照 SVG，放在 `public/funnel-illustrations/leads/05/`，SVG 要有 viewBox、≤ 60KB。

## 7. 感謝頁

- 亮黃徽章；資源卡「第 1 課已寄出」；三步驟：加入通訊錄、準備一扇窗和一支手機、明天收第 2 課；下一步：商品攝影完整課。

## 8. 驗收重點

- 亮黃底上只放深色字。
- 共用檢查（`conversionTemplateIssues`）為空；不跑版 QA 1440／1280／1024／768／390／360＋壓力文案通過。
