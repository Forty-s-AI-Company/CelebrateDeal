# 批次 3（範本 11～15）：共用元件問題與替代作法

> 分支 `ai/webinar-templates-batch-3`。以下問題都沒有修改共用檔案，範本先用最接近的現有能力做出可用版本。修正需要主對話在整合分支處理。

## 共用元件 bug

### B3-1　`icon_list` 的格狀版型在桌機永遠少一欄

- 位置：`src/components/landing-pages/funnel-showcase-elements.tsx` 的 `IconListElement`。
- 原因：`gridColumns()` 用 28px 間距計算欄寬（`funnelFluidGridColumns(count, 28)`），但 `<ol>` 的 style 又把 `gap` 改成 30px。N 欄的總寬會比容器多 2×(N−1)px，`auto-fill` 只能放下 N−1 欄。
- 重現：`icon_list`、`layout: "grid"`、`columns: 2`，放在 1000px 寬的 row。桌機只顯示 1 欄；`columns: 3` 只顯示 2 欄；`columns: 4` 在 1160px 只顯示 3 欄，第 4 項單獨一列。
- 建議修法：`gridColumns()` 與 `<ol>` 使用同一個 gap 值。
- 範本替代：12、13、15 的多欄步驟改用 `agenda_timeline`（`cards` 或 `steps`），沒有使用 `icon_list` 格狀版型。11 與 14 的 `icon_list` 是單欄清單，不受影響。

### B3-2　評價輪播（C-13 `carousel`）的分頁點只有 32×44，違反 L-5

- 位置：`funnel-showcase-elements.tsx` 的 testimonial carousel 分頁點（`className="grid h-11 w-8 …"`）。
- QA 腳本在 1440 與 390 都回報 `[L-5] <button.grid.h-11> 尺寸 32×44 < 44×44`。
- 建議修法：分頁點改成 `w-11`（視覺上的小圓點不變，只放大點擊範圍）。
- 範本替代：spec 11、14 要求的輪播改成 `grid`（11 為 2 欄、14 為 3 欄），全部評價一次顯示，沒有自動播放。

### B3-3　活動資訊列（C-01）在內文 17px 的頁面，手機標籤只有 13.8px

- 位置：`funnel-webinar-elements.tsx` 的 event_facts `<dt className="text-[0.8125em]">`。
- 字級是相對內文的 0.8125em。頁面內文設為 17px 時，標籤只有 13.8px，低於 qa-standards §3.1 的 small 下限 14px（F-3.1）。
- 建議修法：標籤字級改成 `max(14px, 0.8125em)`。
- 範本替代：12、13、14、15 的 `event_facts` 都把節點 `fontSize` 設為 18。

## 缺少的能力

### B3-4　browser-qa harness 不能模擬活動狀態（specs/12 §11）

- harness 沒有傳入漏斗的 webinar 排程，所以 `webinar_state` 永遠顯示「開場前」。QA 腳本只能截到開場前的版面。
- 範本替代：`12-sustainability-ondemand.test.ts` 用 `FunnelPageDocumentRenderer` 加上固定的 `renderedAt`，對開場前、直播中、回放期、已結束各渲染一次，驗證以下三點：
  - 膠囊與 CTA 正確，且不會出現其他狀態的 CTA。
  - 回放章節只在回放期出現。
  - 報名表在四種狀態都存在。
- 建議：harness 增加 `&state=upcoming|live|replay|ended` 參數，用合成排程與 `renderedAt` 渲染。之後 QA 腳本可以加 `--states`，每種狀態都跑 7 種寬度。

### B3-5　`webinar_state` 不能放在 `columns_2` 的欄內 content_box

- `webinar_state` 的 allowedParents 是 row 與 columns_N。`content_box` 不能再包 `content_box`。kit 的 `columns2()` 會把每一欄包成 content_box，所以不能在欄裡放狀態切換。
- 範本替代：12 的首屏直接用 `node("hero_columns", "columns_2", …, [webinar_state, content_box])`，左欄本身就是 `webinar_state`。
- 結果：每個狀態盒都重複了一份 H1 與活動資訊列，四份文字相同，商家要改 H1 時需要改四處。
- 建議：讓 `webinar_state` 可以放在 content_box 內，或讓 `columns2()` 接受直接傳入節點作為一欄。

### B3-6　沒有回放截止日的動態欄位

- 動態欄位只有 date、time、startAt、weekday、timezone、duration、title，沒有 `replayEndsAt`。
- specs/12 的「立即觀看回放（開放至 MM/DD）」因此改寫成「回放限時開放」。
- 建議：新增 `{{webinar.replayEndsAt}}`。

### B3-7　公告條（C-10）的文字不解析 `{{webinar.*}}`

- `AnnouncementBarElement` 直接輸出 `props.text`，不會解析動態欄位。
- specs/13 的公告條「免費直播｜MM/DD」因此改成不含日期的文字，日期改由 inline 倒數（`showCountdown`）呈現。

### B3-8　每個元件不能各自指定字型

- specs/12、15 希望數據數字用 `display-latin`，但節點 style 沒有 fontFamily。`stats` 數字一律使用頁面的標題字型。
- 12、15 的標題維持 `sans-tc`，數字也用思源黑體。
- 13 的標題字型改成 `display-latin`：大數字與英數字會使用 Space Grotesk，中文標題則退回系統黑體。這是因為 `display-latin` 的字型堆疊寫的是字面名稱 "Noto Sans TC"，而 next/font 自架的思源黑體是雜湊後的字族名稱，對不上。
- 建議：
  - 在 `display-latin` 的字型堆疊加入 `var(--funnel-font-sans-tc)`。
  - 或提供「數字字型」頁面設定。

### B3-9　specs/14 要求的 `rounded-tc` 不在 IMPLEMENTING §3.2 的允許清單

- `rounded-tc` 在 FUNNEL_FONT_OPTIONS 只是系統字型堆疊，沒有自架字型。14 的標題改用 `wenkai-tc`，與 spec 中「說法示範」使用的字型一致。

## 刻意的 spec 偏離（範本內處理）

- **11**：
  - 「5 個安定練習」用 `agenda_timeline` vertical（練習 1～5），不用 icon_list 卡片，避免和第 2 區的問句清單長得一樣。
  - I-3 淡入的速度不能設定（spec 要 600ms），沿用平台預設的 `fade`。
- **12**：
  - 第 7 區沒有放第二個表單。整頁只有首屏一個報名表（`#register`），頁尾改成依狀態切換的 CTA，捲回首屏表單。這樣可以避免兩個表單在不同狀態下出現矛盾的文案。
  - FAQ 移到頁尾 CTA 之前。
- **13**：首屏改成黑底。橘色 `#ff6a00` 對白底只有 2.87:1，連大字標準 3:1 都達不到；放在黑底上可以讓「NT$600 → NT$900」維持鮮明的橘色，又通過對比檢查。數據列與案例的橘色小字改用 `#c2410c`。
- **15**：
  - spec 的 accent `#b45f1b` 在淺綠灰區塊只有 4.22:1，改成 `#a3561a`（白底 5.38:1、淺綠灰 4.97:1）。muted 從 `#62786f` 改成 `#5a7067`。
  - 首屏插畫在手機版放在文字下方，不放在上方。放在上方時，375×667 首屏看不到 CTA（L-7）。

### B3-10　`stats` 數字不換行，壓力文案在 320 寬會撐出水平捲動

- 位置：`StatsElement`，數字 span 固定 40px（手機），而且不換行。
- 壓力文案「NT$1,280,000%」在 320 寬比內容區多出 2px（L-1）。
- 範本替代：12 的數據區手機左右留白改成 16px，用 `narrowGutter()` 覆寫 section 的手機 padding。
- 建議修法：數字允許 `overflow-wrap: anywhere`，或用 `clamp()` 依容器寬度縮小字級。

### B3-11　`stats` 在平板 1024 寬把 4 項排成 3＋1

- 平板用 `funnelFluidGridColumns(n, 24)`，每欄最少 240px。1024 寬的內容區約 968px，放得下 3 欄，所以第 4 項單獨一列。spec 要求 4 欄在平板降成 2 欄（I-1）。
- 範本替代：13、15 的 `stats` 在平板覆寫 `width: 600px; margin: 0 auto`，讓 4 項排成 2×2。
- 建議修法：平板欄數用 `columnCount()`（最多 2 欄），與其他格狀元件一致。
