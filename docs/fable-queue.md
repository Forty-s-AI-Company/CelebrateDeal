# Fable 佇列

這些項目留給 Fable 5.2 處理，原因是 Opus 或 Sonnet 試過仍失敗，或判斷錯誤的代價高（跨多個模組、影響資料模型或金流設計）。每項從列出的分支或 commit 接續，達到完成標準後依一般流程合併：測試、必要的獨立審查、CI、merge queue。完成後在該項標題後加上「（已完成，PR 連結）」。

最後更新：2026-11-12。

---

## F-1：CI 才出現的直播精靈「發布步桌機預覽」axe 不穩定失敗（已由 Opus 解決，[#591](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/591)）

CI 帶出 `color-contrast` 規則後，Opus 找到根因：停用按鈕恢復可用時，Tailwind 的 `transition` 讓 opacity 從 0.6 淡入。修法是改用 `transition-colors`，並加上原始碼守門測試與回歸掃描。以下保留當時的紀錄。

- **分支與 commit**：沒有專屬分支。診斷改動 `f0c5a4a8` 已隨 #582 合併進 master：`tests/e2e/accessibility.spec.ts` 的 live stepper 測試改用 `expectNoBlockingAxe`，失敗時 CI annotation 會列出 axe 規則代號（`class=axe_blocking rules=...`）。
- **卡住的原因**：本機（Windows）完全重現不出來，看不到違規的規則與元素，無法定位根因。
- **已經試過**：
  - 本機：單跑 1 次、整份 spec 跑 3 次、完整 e2e（201 個）各一輪，累計 6 次，0 失敗。
  - CI 失敗紀錄：
    - 只改文件的 #577（`920f1e1a`）、#578（`058f7262`）都在 merge queue 通過、推上 master 後失敗。
    - 8740fedd 的 2 次 run、共 4 次嘗試全部失敗。
    - 失敗與通過的 run 用同一個 runner 映像（ubuntu-26.04，20261101.186.1）。
  - 失敗點：`accessibility.spec.ts` 的 `expect(...).toEqual([])`，標籤「發布步桌機預覽」。當時是第 559 行，現在改用 `expectNoBlockingAxe`。
- **建議下手處**：
  1. 先等 CI 再失敗一次，讀 annotation 的 `axe_blocking rules=...`。或在 Linux（WSL、docker 加 Playwright chromium）跑這支測試，這需要下載瀏覽器，請先確認可以下載。
  2. 懷疑方向（都沒證實）：
     - Linux 字型寬度不同，使 `LiveDesktopPreview`（`aspect-video` 加 `overflow-hidden`，白色商品卡片 `mt-12`）溢出被裁切，觸發 `color-contrast` 或 `scrollable-region-focusable`。
     - 點「桌機預覽」後立刻掃描，Email 抽屜關閉與預覽切換的重繪還沒完成。
     - CI 才有的環境變數（例如 `NEXT_PUBLIC_POSTHOG_KEY`）注入了元素。
- **完成標準**：找到根因並修產品或測試的定位，不可以加 retry、放寬門檻或 skip。這支測試在 CI 連續 5 次（含 merge queue）通過。

## F-2：常青場觀眾依自己的場次寄課後信（已完成，[#596](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/596)）

**結果**：新增 `EvergreenSessionAssignment`，在同一個瀏覽器完成 Email 驗證並進入觀看頁的報名者，會在自己的常青場次結束後依規則時間收到課後信；商家設定共用開場時間時，改為以目前的共用開場時間寄給所有已驗證報名者。規則與限制見 `docs/domain-workflows.md`「常青場課後信（F-2）」。**已知限制**：驗證與觀看不在同一個瀏覽器時不會記錄；報名 cookie 只保留最後一筆，同一瀏覽器報名多場時只記最後一場；`{{live_start_at}}` 在課後信用 Asia/Taipei、在常青確認信用商家時區，時區不一致列為後續項目。以下保留開工前的紀錄。

- **分支與 commit**：沒有。目前行為由 #582（`8a01921d`）定義：常青生效期間不寄課後信；關閉常青、結束或改回草稿後，依原開播時間補寄。
- **卡住的原因**：需要資料模型設計與 migration。觀眾的常青場次目前只存在簽章的 httpOnly cookie（`src/lib/evergreen-viewer-session.ts`），在第一次進觀看頁時才計算。`LiveViewerSession` 沒有連到報名紀錄（`FormSubmission`），也沒有存場次時間。
- **已經試過**：#582 的實作者評估過兩個做法。
  - **做法 A**（建議，需要 migration）：新增一張表記錄每位報名者的常青場次。欄位為 `vendorId`、`liveId`、`formSubmissionId`、`sessionStartAt`、`scheduleFingerprint`、`assignedAt`，加 `(vendorId, formSubmissionId)` unique 與租戶外鍵。在 `/api/live-evergreen-session` 指派場次時寫入。cron 改用 `sessionStartAt + 影片長度 + offset` 計算；id 與寄送前檢查也要比對場次。最大的設計點是「cookie 怎麼可靠地綁到已驗證的報名」。
  - **做法 B**（不用 migration，只是近似）：用報名驗證時間推出下一個場次。只適用 `just_in_time` 與 `recurring_daily`，不適用 `on_demand`；觀眾也不一定看那一場，不建議。
- **建議下手處**：先決定觀眾與報名的綁定方式，例如報名確認信裡的觀看連結帶報名 token。再設計 migration（只能往前，並登記到 `docs/codex-goal/PRISMA_INVARIANTS.md`），最後改 `processDuePostLiveFollowups` 與 `isCurrentPostLiveFollowupDelivery`（`src/lib/email-delivery.ts`）。
- **完成標準**：
  - 常青觀眾在自己場次結束後 offset 分鐘收到課後信；沒進過觀看頁的報名者依產品決定處理（見晨間報告的 owner 決定事項）。
  - db test 涵蓋：場次指派、開與關常青、模板改版、重複寄送防護。
  - 合併前要經過 reviewer 獨立審查（migration 加上寄信）。

## F-3：Email 追銷序列（drip）（第一個 PR 已完成，[#598](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/598)）

**結果**：依 `docs/product/delayed-steps-design.md` 完成 PR 1（分支 `ai/f3-email-sequences`）。新增 `EmailSequence`、`EmailSequenceStep`、`DelayedStepRun` 與 migration `20261113150000_email_sequences`；報名者完成 Email 驗證後加入該直播啟用中的序列（job 另有 48 小時補漏），job 每輪每人最多推進一步、逾期 24 小時的步驟跳過，每一步建立附退訂連結的 `sequence_email` 寄送；退訂、黑名單、序列暫停或刪除、報名刪除都會停止。後台 `/messages/sequences` 受 beta 開關 `email_sequences` 控制（平台在 `/admin/vendor-features` 逐商家開通）。**仍未做**：PR 2 的「買了就停」（`stopOnPurchase` 欄位已建立、預設開啟，但目前不讀）、不綁直播的序列（漏斗名單表單等其他起點與 LINE 步驟）、Email 用量計量或每日上限（目前只有每商家 5 條、每條 10 步的上限）。以下保留開工前的紀錄。

- **分支與 commit**：沒有，尚未開工。
- **卡住的原因**：規劃矩陣 P1（「Email 追銷序列」，價值高、成本中高），前置條件是「排程機制確認」。目前只有事件觸發的單封信，沒有 broadcast 或 drip 的 model。需要新的資料模型（序列、步驟、報名者進度）、排程設計（沿用 `email-deliveries` job 或另開）、退訂與黑名單、和現有課後信的關係，都屬於跨模組並影響資料模型的設計。
- **已經試過**：無。
- **建議下手處**：
  - 先盤點現有寄信管線：`src/lib/email-delivery.ts`、`processDuePostLiveFollowups`、`/api/jobs/email-deliveries`、`MessageTemplate`、自動化規則（`funnel-automation-service.ts` 目前只有 `form_registered` 觸發 `add_customer_tag`）。
  - 再寫設計文件，內容包括 model、觸發點、排程、冪等、退訂、跨租戶、配額。
  - 設計確認後再拆成 PR。
- **完成標準**：設計文件定案，第一個 PR 至少能讓「報名後第 N 天寄第 N 封」端到端運作，含 db test 與 e2e；migration 與寄信邏輯要經過獨立審查。

## F-4：自動化規則的多步驟與延遲

- **分支與 commit**：沒有，尚未開工。
- **卡住的原因**：規劃矩陣 P2。目前是 7 個 trigger、4 種 action 的單層規則。要加延遲與多步驟，需要持久化的執行狀態與排程（migration），也會和 F-3 的序列設計重疊。應該和 F-3 一起決定，避免做出兩套排程。
- **建議下手處**：和 F-3 合併設計：同一套「延遲步驟」機制同時服務 Email 序列與自動化規則。
- **完成標準**：設計文件說明與 F-3 的共用方式，並經 owner 確認範圍。

## F-5：課程獨立章節 model 與 AI 課程大綱（AI M4）（章節 model 已完成，[#597](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/597)；AI 課程大綱待 AI M1）

章節已拆成 `CourseChapter`，migration `20261113120000_course_chapter` 與 `20261113120100_course_lesson_chapter_link` 把既有的 `chapterTitle` 回填成章節，學員看到的章節名稱、順序與進度不變；後台課程內容頁依章節分組，可以就地重新命名章節。`CourseLesson.chapterId` 暫時可為空；收緊的步驟是先跑 `repairCourseChapterLinks`（`scripts/repair-course-chapter-links.ts`），確認兩個唯讀查詢皆為 0，再加 NOT NULL（見 `docs/codex-goal/PRISMA_INVARIANTS.md`）。之後的項目：章節排序、刪除章節、搬移單元的專用介面，以及 AI 課程大綱（等 AI M1）。章節目前沒有刪除介面；空章節會佔住名稱，改名後可釋放。以下保留開工前的紀錄。

- **分支與 commit**：`ai/f5-course-chapter-model`（章節 model 與回填）。
- **卡住的原因**：`CourseLesson` 的章節目前只是 `chapterTitle` 字串欄位。拆成獨立章節 model 需要 migration 與資料回填，牽動學員 portal、進度、證書。AI M4 也依賴 M1 到 M3（需要 Cloudflare token）。
- **建議下手處**：先做章節 model 與回填（forward-only migration），AI 部分等 M1 完成再處理。
- **完成標準**：既有課程資料回填後，學員看到的章節與進度不變；db test 與 e2e 涵蓋回填。
