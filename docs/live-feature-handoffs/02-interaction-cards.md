# 02 畫面內互動卡片

## 完成範圍

- 活動編輯頁既有 `LiveInteractionStudio` 加入講師備題、現場新增、手動發送／結束、回答明細與選項統計。真直播與預錄使用同一活動合約，沒有依影片時間自動觸發。
- 觀眾觀看頁加入可收合卡片，不需打開聊天室。提供 160 字短文字、單選、自訂快捷文字及內建 Unicode 表情貼圖；按送出前顯示可見性。選項使用鍵盤可操作的按鈕，文字可 Enter 送出，Escape 收合後把焦點移回展開鈕。
- 卡片寬度最多 22rem，內容高度最多 32dvh 並可內部捲動，輸入字級 16px、主要操作至少 44px。沿用播放器 `playsInline` 頁內觀看；卡片不使用手機原生影片全螢幕疊加。
- 沿用 `LiveInteractionRun` 與 `LiveInteractionResponse`，不另建問題／聊天儲存系統、不要求觀眾重複輸入。本次無 Prisma schema 變更或新增 migration。

## 檔案

- `src/lib/interaction-card-contract.ts`：版本化設定、輸入驗證、公開回答與生命週期白名單 DTO。
- `src/lib/interaction-card.ts`：活動列鎖、草稿／開始／結束、回答冪等、本人投影及講師批次統計。
- `src/app/api/live-interactions/cards/route.ts`：觀眾與講師 API、活動准入、owner/admin 權限、同源、限流及 no-store。
- `src/app/api/live-interactions/route.ts`：既有 API 明確排除卡片讀寫，防止繞過新規則。
- `src/components/live-interaction-card.tsx`、`instructor-interaction-cards.tsx`：觀眾與講師介面；分別由 `live-playback.tsx`、`live-interaction-studio.tsx` 接入。
- `src/lib/interaction-card.test.ts`、`interaction-card.db.test.ts`、`scripts/interaction-card-*-qa.mjs`：合約、真 DB 與瀏覽器驗證。

## 資料與事件合約 v1

`LiveInteractionRun.eventType = interaction_card`、`source = manual`。`configuration` 固定為 `{version:1, kind:"interaction_card", answerType:"text"|"single"|"quick"|"sticker", visibility:"instructor_only"|"public_display", options:string[]}`。題目與可見性建立後不可修改，需建立新題；避免觀眾送出時同意範圍被替換。

生命週期是 `draft → active → closed`，不得重開 closed。每活動同時只有一張 active 卡片。發送下一題會在同一 transaction 結束前題。`startsAt` 記錄實際手動開始時間，closed 的 `endsAt` 記錄實際結束時間；active 的 DB endsAt 使用遠期值維持既有非 nullable 欄位，對外 DTO 回傳 null，後續排程不得把此相容值解讀為排程截止時間。draft 的公開 DTO startsAt/endsAt 都是 null。

`cardLifecycle` 產生 `card.started`／`card.ended`：version、vendorId、liveId、runId、startsAt、endsAt、visibility，沒有任何回答或個資。本次以輪詢傳遞狀態，沒有新增事件匯流排。後續排程應呼叫相同 command 與活動鎖，不能直接寫資料表；自動觸發與個人播放時間語意留給下一功能。

回答沿用一筆 `LiveInteractionResponse`；`runId + participantHash` 唯一。身分只取綁定 vendor/live 的有效觀眾 admission token hash，不接受瀏覽器自選作者、participantHash 或 visibility。同值重送回傳原回答，包含題目結束後的網路重試；不同值改答回 409；未回答者對 closed 題目回 409。所有卡片寫入先以 vendor/live 鎖定 Live 列，避免結束／切題與回答競態。

私人回答只回本人 `ownValue` 與已授權講師明細。觀眾 DTO 不含他人答案、參與者身分、統計或 raw DB row。所有回應皆 private/no-store。卡片不寫 `LiveChatMessage` 或 `InteractionEvent`。

`public_display` 代表此回答允許後續公開展示，本次不發送公開內容或實作彈幕。後续只能以可信 run.configuration 呼叫 `publicCardAnswer`，私人設定回傳 null；公開 DTO 只含 version/type/id/runId/value/visibility，不展開 raw response。傳輸層仍須依 run 解析租戶／活動，不能信任客戶端提供的 scope 或可見性。

講師端每次最多列出最近 100 題，以批次 groupBy 取得全部回應計數及選項票數；只對選中的一題讀最新 100 筆明細，避免逐題 N+1 查詢。完整回答仍儲存於既有紀錄；超過 100 筆的歷史明細目前沒有 UI 分頁，介面會明示截取範圍。

## 實際驗證

- 8 個測試檔、125 項 targeted tests 通過：卡片合約、既有互動 API／domain、問題、講師 actions、播放器及觀看頁面。
- `node scripts/interaction-card-disposable-qa.mjs`：5 項真實 PostgreSQL 測試通過、無 skipped。使用原先不存在的 allowlisted loopback DB、完整 migrations 與 ownership marker，測後清除本次 DB。包含並行重送、已結束／切換題目、重新讀取本人回答、兩名觀眾隔離、owner／accountant／未登入、跨租戶／跨活動、舊 API 不可繞過，以及選項統計。登入與 limiter 為合成邊界，API/domain/DB 為真實。見 `interaction-card-db-evidence.json`。
- 初次 DB fixture 缺少必填 lastSeenAt，測試失敗；補齊 fixture 後通過，receipt 保留失敗紀錄，未降低 assertion。
- `node scripts/interaction-card-browser-qa.mjs`：真實 React 元件、合成 API、Edge 390×844 與 844×390 viewport。備題／發送／結束、隱私告知、鍵盤回答、重新整理、講師查看、切題清空、快捷文字、收合／展開、無橫向溢出、16px 輸入與零 page errors 通過。見 `interaction-card-browser-evidence.json` 和 mobile/landscape/instructor PNG。影音是頁內測試容器，不是外部實播 E2E。
- 全專案 `tsc --noEmit`、本次 TS/TSX/QA scripts ESLint、`git diff --check` 通過。新路由另以不含環境檔的隔離來源副本執行 Next typegen／TypeScript，見 `interaction-card-typecheck-evidence.json`。
- 隔離來源副本首次漏帶根目錄相依的 Sentry 設定、測試安全工具及 manifest，typegen 成功、TypeScript 失敗；補齊相依檔案後兩者通過，receipt 保留該次失敗。
- Terra 唯讀權限／競態審查未找到可重現的租戶越權或私人外洩；其指出的逐題統計查詢已改為批次摘要及單题明細。AGY models 回報登入及目錄權限限制，未進行 Claude/Gemini 審查，不宣稱通過。

## CI、限制與回滾

`.github/workflows/ci.yml` 已於 push/PR 執行 ESLint、typecheck、單元測試及 coverage，也啟用 disposable DB 測試。沿用設定，未 push、未執行遠端 CI、未部署或操作正式服務。ai-team-pro router 已套用；模式切換腳本因 `.codex/config.toml` 權限拒絕未完整成功，沒有繞過。

未驗證實體 iPhone／Android、Safari、外部影音與正式登入。手機原生影片全螢幕通常不包含網頁卡片，請退出原生全螢幕使用現有頁內觀看；本次未宣稱真機全螢幕通過。可見性為公開展示授權，沒有公開回答播放或彈幕 UI。

回滾以精確撤除兩處 UI 接線及卡片 API 進行，保留卡片資料與舊 API 對 interaction_card 的排除，避免舊入口重新暴露／寫入卡片。不要把私人回答改成一般聊天室或公開事件。下一功能復用上述 run/response、visibility、生命週期及活動鎖。

## Checkpoint

本次僅包含上述新增檔及三處既有功能接線／排除變更；保留私密聊天室與 AI team 的既有未提交工作。已執行精確檔案清單的 `git add -- ...`，Git 回報 `.git/index.lock: Permission denied`，因此未 stage、未建立 commit，沒有 commit hash；未繞過權限。實作與驗證文件留在工作目錄。
