# 批次 4（16～20）實作筆記：共用元件問題與替代做法

> 範本工作階段不改共用檔案。以下是實作 16～20 時遇到的元件 bug 或缺少的能力，交給主對話評估；每一項都附上範本目前的替代做法。

## A. 元件 bug

### A-1 `icon_list` 的 2／3 欄格線在桌機會少一欄
- 位置：`src/components/landing-pages/funnel-showcase-elements.tsx` `IconListElement`。
- 原因：`gridColumns(columns, viewport)` 用 gap 28 算 `funnelFluidGridColumns`，但 `IconListElement` 又把實際 gap 改成 30（手機 22）。軌道最小寬是 `(100% − 2×28) / 3`，加上實際 60px 的 gap 會超出容器，`auto-fill` 只放得下 2 欄（2 欄時只放得下 1 欄）。
- 影響：`layout: "grid"` 的 `icon_list` 在 1080–1440 寬永遠比設定少一欄（00-example 的「這 90 分鐘你會帶走」也是 2＋1）。
- 建議：計算欄寬與實際 gap 用同一個值。
- 範本替代：需要多欄的編號清單改用 C-03 `agenda_timeline`（`steps`／`cards`），它的 gap 與欄寬一致；單欄清單照用 `icon_list`。

### A-2 C-01 活動資訊列的標籤在手機只有 13.8px
- `dt` 是 `0.8125em`；頁面內文 17px 時手機只有 13.8px，QA 腳本 F-3.1（small ≥ 14px）不通過。
- 範本替代：在 `event_facts` 加手機覆寫 `fontSize: 18`。
- 建議：`dt` 改成 `max(14px, 0.8125em)`。

### A-3 C-01 在置中區段裡，手機 2×2 格的文字對齊不一致
- 置中區段（`textAlign: center`）讓 `dt`／`dd` 置中，但圖示在左，看起來歪。
- 範本替代：`event_facts` 節點加 `textAlign: "left"`。

## B. 缺少的能力（規格要求，但目前做不到）

| # | 規格 | 缺少什麼 | 範本目前的做法 |
|---|---|---|---|
| B-1 | 16 首屏：手機兩張講者照並排（各 50%、4:5） | C-02 `duo` 在手機會上下堆疊（每張 220px），首屏看不到 CTA；沒有「手機維持兩欄」的元件 | 桌機／平板用 C-02 `duo`；手機隱藏它，改顯示一張並排雙人佔位圖（`16/duo-mobile.svg`），姓名職稱放在圖片下方的文字。商家要替換兩張照片＋一張手機合成圖 |
| B-2 | 16 首屏：照片區最大寬 960px、「×」垂直置中 | C-02 `duo` 的照片固定 max 280px、「×」靠上對齊 | 首屏內容寬縮成 800px，讓兩張照片靠近 |
| B-3 | 16 報名表「想問講者的問題」textarea | `form_input` 只有 `<input>`；公開頁欄位來自伺服器報名表 | 放一個 `name: "question"` 的 `form_input`（提示文字＋說明）；商家在報名表新增 `question` 欄位後會套用這個外觀 |
| B-4 | 17 標題 weight 300、16／17／19／20 的 `display-latin` 指定 Fraunces／DM Serif | 節點樣式沒有 `fontWeight`／`fontFamily`；`display-latin` 只有 Space Grotesk | 用預設字重；英文眉標用 `section_title` 的 `eyebrowItalic` 表現攝影集感 |
| B-5 | 17 作品集手機 2 欄、19 學員作品手機 2 欄 | C-17 在手機一律 1 欄 | 維持 1 欄（大圖單欄在手機仍好看） |
| B-6 | 17 `image_cards` 3:2 | `image_cards` 只有 4:3、1:1、3:4、16:9 | 用 4:3 |
| B-7 | 18 程式碼上色用 spec 指定的 4 色、等寬 eyebrow／時間碼 | C-18 顏色寫死；節點不能指定等寬字 | 用 C-18 內建配色（對比已達 AA）；eyebrow 用 `// live coding` 文字表現 |
| B-8 | 18 C-16 編輯器框內放 C-18 | C-16 只能放圖片，不能包其他元件 | 直接用 C-18（自帶檔名列，看起來就是編輯器框） |
| B-9 | 19 食譜卡虛線邊框、插畫輕微浮動、列印按鈕 | 樣式沒有 `borderStyle`；沒有裝飾動畫；沒有列印動作 | 實線 2px＋20px 圓角的紙卡；不做浮動與列印 |
| B-10 | `content_box` 內再放 `content_box` | 契約不允許（`allowedParents`），`columns2()` 已經包一層 content_box，所以兩欄裡不能再放有底色的卡片 | 需要卡片欄時，直接用 `node(id, "columns_2", …, [卡片 content_box, 卡片 content_box])` |

## C. 交付說明

- 證據截圖放在 `docs/ai-team/evidence/webinar-templates/batch-4/`（依本批次任務指示，40 張 JPEG、約 11MB）。IMPLEMENTING.md §4 建議截圖放不合併的 `*-screenshots` 分支；合併成單一 PR 前請主對話決定是否移出。
- 20 號的禁用詞清單匯出為 `AESTHETIC_CLINIC_BANNED_WORDS`，由 `20-aesthetic-clinic.test.ts` 掃描範本全部文字。
- 範本的醫師證書字號、診所地址、醫療機構代碼都是「請填入」佔位。
