# 批次 1（範本 01–05）筆記：共用元件問題與規格偏離

> 範圍：`01-ai-minimal`、`02-saas-split`、`03-design-workshop`、`04-finance-host`、`05-realestate-countdown`。
> 依 IMPLEMENTING.md，批次 1 沒有修改任何共用檔案；以下問題都用現有能力做出可用版本，交給整合分支處理。

## 1. 共用元件 bug（建議整合分支修正）

| # | 元件 | 問題 | 重現 | 批次 1 的替代做法 |
|---|---|---|---|---|
| B-1 | `icon_list`（`layout: "grid"`） | 欄數永遠少一欄。`gridColumns()` 用 gap 28／24 計算 `funnelFluidGridColumns`，但 `IconListElement` 再把 gap 覆寫成 30（手機 22），`auto-fill` 每次差幾 px 放不下最後一欄。`columns: 3` 在桌機只有 2 欄；`columns: 2` 在平板只有 1 欄 | `00-example` 的「你將學到」在 1440 寬是 2＋1 排列 | 01、03、04、05 改用 `columns_3`／`columns_4`／`columns_2` 加 `content_box` 卡片；`icon_list` 只用 `layout: "list"` |
| B-2 | `section_title` | `subtitle` 不會解析 `{{webinar.*}}` 動態欄位，畫面直接顯示 `{{webinar.startAt}}` | 在 subtitle 放 `{{webinar.startAt}}` | 日期另外放一個 `text` 節點 |
| B-3 | `event_facts` | 標籤 `<dt>` 是 `0.8125em`；手機 body 上限 17px 時只有 13.8px，QA F-3.1（< 14px）失敗 | 範本 `bodySize: 17` 時的 390 寬 | 該節點加 `mobile: { style: { fontSize: 18 } }` |
| B-4 | `event_facts`（`layout: "row"`） | 平板與手機固定 2 欄，事實數為奇數時最後一格孤立。harness 沒有排程時只有「日期、形式、費用」3 格，必定出現孤格 | 任一範本 390 寬 | 範本預設 `showDate`＋`showTime`＋`formatLabel`＋`priceLabel`，有排程時剛好 4 格；沒有排程時無法避免。建議奇數時最後一格跨 2 欄 |
| B-5 | 對比檢查 `findFunnelContrastIssues` | 按鈕 `backgroundColor: "transparent"` 被當成預設按鈕底 `#f59e0b` 計算，產生假的對比失敗 | 03 的「先看議程 ↓」文字連結按鈕 | 改用與區段相同的實色底（`#faf7f2`） |
| B-6 | `testimonial_wall`（`marquee`） | 壓力文案下用 `line-clamp` 截斷長評價，QA L-3 失敗（與黑金範本的已知問題相同） | 04 原本用 2 排跑馬燈 | 04 改用 `grid`（3 欄，不截斷） |
| B-7 | `image_gallery`（`layout: "grid"`） | 等高格狀會把方形圖片放在較寬的格子裡，左右出現灰色底，看起來像沒對齊 | 03 學員作品 6 張 1:1 SVG | 改用 `masonry` |
| B-8 | `testimonial_wall`（`carousel`） | 壓力文案下，左右切換按鈕被擠成 32×44，QA L-5（≥ 44×44）失敗 | 04 改用 carousel 時的 1440 壓力文案 | 04 改用 `grid` |

## 2. 缺少的能力（建議列入後續）

- **harness 沒有活動排程**：`/browser-qa/funnel-design` 沒有帶 webinar 排程，倒數、活動資訊列與 `{{webinar.*}}` 一律顯示「時間公布中」，`deadline_notice` 不顯示。因此 spec 05 §11 的「360 寬倒數 4 格一行、每格 ≥ 68px、3 位數天數」**無法用 QA 腳本驗證**。建議 harness 支援 `&schedule=sample`（例如 3 天後開播、120 天後開播、已開播、回放中）。
- **單一節點不能指定字族或字重**：spec 01／02／05 要求數字用 `display-latin`、03 標題 900 字重，目前只能用頁面主題的兩個字族與預設字重，範本以主題字型呈現。
- **巢狀 `content_box`**：`columns2()` 會把每欄包成 `content_box`，所以欄內不能再放 `content_box` 卡片（PageDocument 驗證會失敗）。2×2 卡片改用 `node(id, "columns_2", …, [卡片×4])`，4 個子節點會自動排成兩列，手機依 1→4 順序堆疊。建議在 IMPLEMENTING.md 補一句。
- **按鈕旁的次要文字連結**：`content_box` 內無法把兩個按鈕排成同一列；03 的「先看議程 ↓」以文字樣式的按鈕放在主 CTA 下方。

## 3. 規格偏離（都是為了避開上面的問題或達到 QA 標準）

| 範本 | spec | 實作 | 原因 |
|---|---|---|---|
| 01 | 你將學到用 `icon_list`（3 欄） | `columns_3`（平板也堆疊）＋編號卡片 | B-1 |
| 02 | 議程用 `icon_list`（numbered） | C-03 `agenda_timeline`（`cards`） | B-1；C-03 已可用 |
| 03 | 適合誰／學到用 `icon_list` 2 欄 | `columns_4`／2×2 `columns_2` 粗框卡片 | B-1 |
| 03 | 學員作品用 `image_cards` | C-17 `image_gallery`（masonry） | 作品集元件已可用、可放大檢視 |
| 04 | 評價用 2 排 marquee | `grid`（3 欄） | B-6、B-8 |
| 04 | 手機講者圖 4:3 | 另一張 2:1 寬版主視覺（`mobile`／`tablet` 覆寫 `src`） | 375×667 首屏要看得到表單第一個欄位（L-7） |
| 05 | 流程用 C-03 `cards` | `columns_4` 卡片（桌機 4 欄、平板 2×2、手機單欄） | C-03 `cards` 桌機固定 3 欄，4 段會變成 3＋1；`steps` 同樣 3＋1 |
| 05 | 第 6 區標題含「名額有限」語氣 | 「開播前，把你的席位留下來」 | 不放假名額（IMPLEMENTING.md §6） |

## 4. 其他觀察

- 開發伺服器 `next dev`（`FUNNEL_ELEMENTS_E2E=true`）會自動改寫 `tsconfig.json` 的 `include`（加入 `.next-funnel-elements/types/**`）。範本分支沒有 commit 這個變更。
- 公開頁表單的欄位標籤與送出文字來自伺服器報名表，所以 harness 截圖的按鈕文字是「免費報名」，不是範本的 `submitLabel`（符合 IMPLEMENTING.md §3.5 C-19 的說明）。

- **QA 偶發失敗**：5 個範本合併跑（85 回合）時，曾出現 1 次 `LOAD`（30 秒內未就緒，02@1440 壓力）與 3 次 `HYDRATION`（03@1440、360、320 壓力）。單獨重跑 02（17 回合）、03（兩次各 17 回合）都是 0 失敗，在瀏覽器重載 03 五次也沒有 console 錯誤。推測是同機有多個 dev server 時的編譯負載；若整合分支合併後仍重現，建議讓 QA 腳本在 `HYDRATION` 時自動重試一次並保留完整訊息（目前 report.json 的 detail 只保留前 200 字，看不到差異的節點）。
- QA 證據：`docs/ai-team/evidence/webinar-templates/batch-1/`（README 有每回合結果）。
