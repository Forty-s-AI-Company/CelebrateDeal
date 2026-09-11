# 01 — 私密聊天室交接

## 完成範圍

沿用既有 `LiveChatMessage`、觀眾 API 與 3 秒輪詢傳輸；沒有建立第二套訊息系統或登入流程。

- 觀眾只能查詢本人留言與講師對本人的回覆，包含歷史分頁。未驗證訪客只取得空訊息清單；完成既有 Email 報名驗證的訪客可直接對話，不需要後台帳號。
- 講師從 `/lives` 的「私密聊天室」進入 `/lives/[id]/chat`，選擇觀眾、閱讀歷史與回覆。沿用既有 owner/admin 活動管理權限。
- 每次讀寫都以伺服器身分驗證與租戶／活動／報名範圍約束。API 不接受觀眾自選收件人、作者或訊息 source；管理端 vendorId 只從管理員 session 取得。
- 手機文字輸入採 16px、44px 以上操作區；支援斷線保留草稿、重試、訊息去重與切換對象清除狀態。
- 與影音來源解耦，真直播與預錄沿用相同活動 admission 與聊天 API。既有播放器回歸測試通過；未對外部影音服務進行實播。

## 檔案與資料合約

- `src/lib/live-chat.ts`：身分、查詢、歷史游標、寫入及雙方冪等邏輯。
- `src/app/api/live-chat/messages/route.ts`：沿用觀眾入口；strict query/body schema 拒絕猜測 ID、submissionId 與 source 注入。
- `src/app/api/live-chat/instructor/route.ts`：管理員 GET/POST，所有回應 `private, no-store`，沿用同源檢查及限流。
- `src/components/live-chat-panel.tsx`、`instructor-chat-panel.tsx`：觀眾與講師實際互動介面。
- `src/app/(app)/lives/[id]/chat/page.tsx`、`src/app/(app)/lives/page.tsx`：後台頁面及入口。
- `prisma/migrations/20260911010000_private_live_chat/migration.sql`：原子擴充既有 source／identity constraints，新增對話索引；沒有刪除或改寫歷史資料。

儲存 source：新觀眾訊息 `private_viewer`、講師私人回覆 `private_instructor`；`formSubmissionId` 是同一活動下的對話收件人。兩者強制有 submission、無 role，且不得是 simulated。保留原本複合 foreign keys。

觀眾 GET 固定查詢 `(vendorId, liveId, formSubmissionId)`，僅 `visible`、非 simulated、無 role 的 viewer/private_viewer/private_instructor 列。舊 `viewer` 資料未重新分類，只有原作者能由觀眾入口讀取；沒有可驗證身分的舊資料不公開給觀眾。

DTO `source` 為 `viewer | instructor`，只從私密 API 傳回；不包含收件人 ID、Email、電話或憑證。講師名單僅傳回授權活動的報名 ID／姓名，每頁 100 筆；對話每頁 50 筆，使用既有簽章游標。

輪詢就是既有即時傳輸，沒有新增 WebSocket、Supabase subscription 或公開 broadcast。每次重新整理／重連均重走同一權限查詢。私人列不進入 `InteractionEvent`、公開腳本／彈幕；既有公開分析／匯出維持 source=viewer，CRM 亦明確排除私人列。

## 驗證與安全審查

- 153 項 targeted tests 通過：聊天室 domain／API、訊息 DTO、觀眾元件、CRM、訪客簽章身分、播放器與觀看頁面（10 個測試檔）。
- `node scripts/private-chat-disposable-qa.mjs --loopback-database`：在原先不存在且有 ownership marker 的獨立本機 DB 套用全部 migrations，再執行真實 DB 測試，5／5 通過、0 skipped，包含實際 API handler → domain → PostgreSQL。登入身分、可信 IP 與 limiter 為合成邊界；詳細結果見 `private-chat-db-evidence.json`。測後只清除本次建立的 DB 與暫存目錄。
- `node scripts/private-chat-disposable-qa.mjs --verify-receipt`：驗證 evidence。
- `node scripts/private-chat-browser-qa.mjs`：真實 React 元件、Edge 手機 viewport、合成 API 邊界；手機輸入、講師選擇 A/B、回覆、重新整理、輪詢去重、斷線重試、無橫向溢出、無 page errors 通過。詳見 `private-chat-browser-evidence.json` 及兩張 PNG。這不是正式登入／外部服務端到端證據。
- 全專案 `tsc --noEmit` 通過；另在不含環境檔的隔離目錄執行 Next route typegen 與新產生 route validator 的 TypeScript 檢查，均通過，避免載入 `.env*`。
- 本次修改 TypeScript／TSX／QA scripts 的 ESLint 及 `git diff --check` 通過。
- Terra 唯讀安全複審與 migration 複審：未發現可重現越權、跨租戶或私訊外洩漏洞。前次僅因原生工具清單無 Claude 入口而直接降級，沒有測試 AGY CLI，該判定不充分。2026-09-11 補查確認本機有 AGY；`agy models` 在此執行環境回報需登入及目錄權限限制，未取得最新模型清單。私密聊天室未經 Claude 審查，保留 Terra 審查結果。

失敗證據：原本本機測試 DB 結構落後；Docker API pipe 權限拒絕。改以新建、可核實 ownership 的本機 DB 驗證。初次真 DB 發現舊 constraints 不接受 private source，新增 migration 後通過。Receipt 保存重試前的實際失敗。

## CI、模式與尚未驗證範圍

`.github/workflows/ci.yml` 已在每次 push／PR 執行 ESLint、typecheck、單元測試與 coverage，且先套 migrations、啟用 disposable DB tests，因此沿用，不另加自動部署。未 push、未觸發遠端 CI；此處確認的是 workflow 設定及本機檢查，不宣稱遠端 CI PASS。

已執行 ai-team-pro 切換腳本，router 已切換；`.codex/config.toml` 寫入被 sandbox 拒絕，完整模式設定未能寫入，未繞過權限或宣稱动态切換模型。

未對 staging／Production 套用 migration 或部署，未驗證外部影音、正式登入、多瀏覽器／實體手機。上線前必須由已授權流程先套用新增 migration；不可只部署程式而漏掉 constraints 擴充。

## 回滾與後續依賴

回滾應使用明確 scope 的程式修訂，並保留 private source 與資料庫約束；停用私訊寫入時仍不可把 private 列改成 viewer、公開傳送或刪除。已產生私訊後不能直接恢復舊 source constraint，否則會與合法私訊資料衝突。

下一功能的公開互動卡片／彈幕必須使用明確獨立的公開事件合約；不得取用本次私密 API DTO 或以私人回覆填入公開腳本。既有公開訊息分析不會統計新私人列，若要新增私訊統計，須另立不輸出內容的管理端查詢。

## Checkpoint

保留既有 router 修改與兩份 session／構想文件，不納入本次 ownership。已對本次明確變更執行精確檔案清單的 `git add -- ...`；Git 回報無法建立 `.git/index.lock`（Permission denied），因此未 stage、未建立 commit，無 commit hash。實作與證據均保存在工作目錄，未繞過 `.git` 權限；未 push／merge／部署。
