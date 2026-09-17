# Funnel systeme.io 流程對齊證據

- 日期：2026-09-18
- 目標：驗證 `Funnels → 建立 → Goal/Step 模板 → Funnel 管理 → Configuration → Edit Page → Editor → 原 Step Configuration`
- 執行環境：本機 production build、Chromium、隔離的 loopback PostgreSQL `celebratedeal_test`、合成 TEST ONLY 帳號與資料。
- 安全界線：未讀取 `.env*`、未使用正式 Secret、未接觸正式服務或正式資料。
- 擷取命令：`npx playwright test tests/e2e/funnel-parity-capture.tmp.spec.ts --config=playwright.config.ts`
- 結果：`1 passed (6.5m)`；測試依序建立 Sell、Audience、Custom、Webinar Funnel 並操作真實 UI。

## 實際畫面對照

| 參考畫面 | 目前入口與證據 | 已對齊 | 剩餘差異 | 主要修正檔案 | 驗收操作 |
|---|---|---|---|---|---|
| `02`–`03` 建立 Funnel | `/landing-pages/new`；`01-create-sell.png` | 名稱、網址、Goal、幣別、Save disabled/ready 狀態；成功後持久化並進 Funnel 詳情 | CelebrateDeal 使用完整建立頁；systeme.io 為 modal。欄位與後續狀態一致 | `funnel-goal-picker.tsx`、`new/page.tsx` | 填入四欄、選 Sell、儲存後確認 `/operations` |
| `05` Sell 模板選擇 | `/landing-pages/:id/operations`；`02-sell-template-picker.png` | 左側三個預設 Steps、七分頁、選模板前其他分頁 disabled、Sell/order_form 專用模板 | 目前提供 3 個精選模板；systeme.io 顯示 9 張與分頁 | `funnel-template-gallery.ts`、`funnel-template-gallery-picker.tsx` | 建立 Sell，確認只列 Sell/order_form 模板並套用第一張 |
| `09` Sell Configuration | 同上；`03-sell-configuration.png` | Step 名稱、URL Path、View step、Edit Page、更換模板；選模板後七分頁啟用 | systeme.io 的聯盟佣金、銷售上限、Offer/Coupon/Order bump 屬後續商務欄位，不在本輪流程重構內 | `funnel-operations-panel.tsx` | 套用模板後確認 revision 增加、Edit Page enabled |
| `11`–`29` Editor | `/landing-pages/:id?step=:stepId`；`04-sell-editor.png` | Editor 只編輯 active Step；Save、Preview、桌機/手機、Popups、頁面設定及返回 Configuration | 視覺沿用 CelebrateDeal Editor；未逐像素複製 systeme.io | `landing-page-workspace.tsx`、`[id]/page.tsx` | Configuration 點 Edit Page；Save 後返回，URL 保留同一 Step |
| `82` Automation Rules | Funnel 管理；`05-automation-rules.png` | 從同一管理頁切換 Automation Rules；Configuration 責任邊界保留 | 規則引擎沿用 CelebrateDeal 現有能力 | `funnel-operations-panel.tsx` | Editor 返回後點 Automation Rules，確認真實 automation 區塊 |
| `33` Audience 模板選擇 | Funnel 管理；`06-audience-template-picker.png` | Audience 預設名單頁、感謝／下載頁、停用頁；模板只列 audience/opt_in_page | 目前 3 個精選模板；systeme.io 顯示更多模板與分頁 | `funnel-flow.ts`、`funnel-template-gallery.ts` | 建立 Audience，確認 Goal/Step 過濾與選模板前 disabled 狀態 |
| `40`–`46` Custom 空白與 Add step | Funnel 管理；`07-custom-empty.png`、`08-custom-add-step.png`、`09-custom-configuration.png` | 建立後只有停用頁；Add step 才選 Type、模板／空白；單次儲存後直接進 Configuration | Step type 以繁中分群選單呈現，互動密度略低於 systeme.io | `funnel-operations-panel.tsx`、`funnel-goal-step-pages.ts` | 建立 Custom、確認空狀態；新增 Info Page 並選模板；確認無半建立 Step |
| `47`、`48`、`72` Webinar | Funnel 管理；`10-webinar-current-unverified.png` | CelebrateDeal 目前建立報名、感謝、播放、停用四個 Step，並能進 Configuration/Edit Page | 參考帳號受 Webinar 方案限制，systeme.io 詳情與模板未能實測；此圖只證明 CelebrateDeal 現況，不宣稱視覺或流程完全一致 | `funnel-flow.ts`、`funnel-goal-step-pages.ts` | 建立 Webinar，確認三個業務 Step、停用頁與七分頁 |

## 自動驗收

- 四 Goal 核心旅程：`tests/e2e/funnel-goals-final.spec.ts`，4/4 通過。
- Operations 完整回歸：`tests/e2e/funnel-operations.spec.ts`，1/1 通過；涵蓋儲存後立即返回、reload、revision conflict、三種報表、A/B、Automation 與 Deadline redirect。
- 本次畫面證據：production build + Chromium，1/1 通過。
- Funnel targeted Vitest：7 files、56 tests 通過。
- TypeScript：`npm run typecheck` 通過。
- ESLint：0 errors；3 個既有 `landing-page-puck-config.tsx` `<img>` 警告。
- CI：`.github/workflows/ci.yml` 已在 push 執行 typecheck、Vitest/coverage 與 Playwright，未新增重複 workflow。

## 結論與界線

本輪已完成使用者指定的跨頁 Funnel 主流程、Goal/Step 模板過濾、Custom 空白流程、七分頁、active Step Editor 與返回路徑。模板數量／分頁、Sell 商務進階欄位、方案配額，以及 systeme.io 無法實測的 Webinar 詳情仍是後續 parity 工作，未標示為完成。

回歸過程另修正兩個真實競態／持久化問題：Editor 在 Save 進行中收到返回操作時，現在會等成功儲存後自動回到原 Configuration；Deadline redirect 現在只排除進行中的 A/B Steps，已停止的實驗可安全導向已發布的非首頁 Step。
