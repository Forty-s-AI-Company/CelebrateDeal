# 07 互動卡片彈幕

## 完成範圍

- 真人來源只取 `interaction_card` 的 `public_display` 文字、快捷回應與內建 Unicode 貼圖。排除單選統計、私人卡片、全部一般／私人聊天、講師私人回覆及預設角色。
- API 在資料庫查詢時就以 response 與 run 的 vendor/live/eventType/visibility 限制範圍，再以可信卡片設定驗證內容；沒有把私人資料先傳到瀏覽器再隱藏。
- 公開名稱固定為「觀眾」。不讀取或投影帳號、Email、報名識別、participant hash 或 response.displayName。公開卡片送出前說明名稱與公開授權，提醒不要填私人聯絡資料。
- 講師在 `/lives/[id]/presenter` 直播工作室及活動編輯頁 `LiveInteractionStudio` 操作同一個持久化總開關。owner/admin 才能寫入，vendorId 只取伺服器 session。
- 觀眾觀看區提供個人開關；偏好依 vendor/live 存在 localStorage，無法使用 storage 時保留本頁記憶偏好。講師重開不覆蓋個人隱藏狀態。
- 真直播與預錄沿用相同 admission、卡片回答與彈幕資料流；個人預錄顯示當下同活動的公開回答，不重播历史回答或合成角色內容。
- 採獨立互動窄列與單則文字滑動，不疊在簡報、卡片或播放器操作區。沿用橫／直式觀看容器與頁內全螢幕；減少動態效果時靜態顯示。

## 檔案與合約

- `src/lib/live-danmaku-contract.ts`：白名單匿名投影、20 筆 bounded queue、去重與 10 秒到期。
- `src/lib/live-danmaku.ts`：讀取、總開關、活動列鎖、DB clock 水位；只查既有 `LiveInteractionResponse`，沒有新增訊息儲存或 broadcast 表。
- `src/app/api/live-danmaku/route.ts`：GET 觀眾准入、GET/POST 管理權限、同源、strict schema、限流、所有回應 private/no-store。
- `src/components/live-danmaku.tsx`：兩入口共用管理開關及觀眾輪詢、排隊、偏好與斷線清空。
- `live-playback.tsx`、`live-interaction-studio.tsx`、`presenter-studio.tsx`：接線；`globals.css`：窄列、動畫與 reduced-motion。
- `interaction-card.ts`：保留原回答冪等與驗證，新增每位 participant 每活動 10 秒最多 3 個新回答；同值重送不計新回答。回答時間改取活動鎖之後的 DB wall clock，避免等待中的 transaction-start timestamp 落後輪詢水位。
- `live-interaction-card.tsx`：公開名稱告知與限速回饋。
- `prisma/schema.prisma` 與 `20260911070000_live_danmaku/migration.sql`：只新增 nullable `Live.danmakuState` JSONB；舊活動預設關閉。

持久設定為 `{enabled:boolean, epoch:string, since:ISODate}`。實際狀態切換產生新 epoch；重送同狀態保持 epoch。設定與回答共用 Live row lock，關閉後伺服器不再提供彈幕內容。

觀眾 GET 參數為 vendorId/liveId 與選填 cursor/epoch。回應只有 `{state,cursor,items}`，item 僅 `{id,value,displayName:"觀眾",createdAt}`。首次進場、epoch 不符及斷線重連先取得空清單與新水位。每次最多取最近 10 秒內最新 20 筆；飽和時丟棄過量內容，不翻頁回填。水位邊界採包含時間並以 ID 去重。

收到關閉或新 epoch 時清空目前畫面與待播 queue；個人隱藏、背景頁面、HTTP 失敗或逾時也清空。重新開啟不補播舊批次。文字沿用 160 字與選项／貼圖白名單；同時最多 1 則，每 3.5 秒換一則，待播最多 20 則，10 秒即過期。

## 同步語意與限制

沿用本專案輪詢傳輸：一次成功請求後隔 2 秒再同步，觀眾請求 4 秒逾時後停止顯示。講師關閉提交後，觀眾在下一次狀態送達時清空；網路延遲期間仍可能短暫看到已收到的公開內容。這是最終一致的開關，**沒有宣稱跨裝置零延遲停止**，也沒有新增 SSE/WebSocket 服務。

Terra 唯讀審查確認上述延遲，未找到私人回答或身分欄位外洩路徑。AGY `models` 實際回報登入與目錄權限限制，Claude/Gemini 審查未執行；依專案階梯改用 Terra，不把工具阻擋算成 PASS。

## 實際驗證

- `node scripts/danmaku-checks.mjs`：獨立 Prisma client 產生、無環境檔來源鏡像的 Next typegen、全專案 TypeScript、本次檔案 ESLint 零警告、6 檔 114 項 targeted tests 全數通過。詳見 `danmaku-checks.json`。
- `node scripts/danmaku-disposable-qa.mjs`：僅建立原先不存在、具 ownership marker 的 allowlisted loopback PostgreSQL DB，套用全部 migrations；4 項真 API/domain/DB 測試通過，零 skipped，測後清除本次 DB。覆蓋兩名觀眾、PRIVATE 卡片／聊天／講師回覆排除、匿名 DTO、未登入與 role、跨租戶／同租戶跨活動、觀眾不能寫開關、重送／重开、30 筆並行突增、預錄及跨卡片限速。登入及限流是合成邊界，資料庫與 route/domain 為真實。詳見 `danmaku-db-evidence.json`。
- `node scripts/danmaku-browser-qa.mjs`：真 React 元件、既有觀看容器與 CSS、合成 HTTP API、Edge 390×844／844×390。涵蓋兩個講師入口同步、個人偏好經重開／重新整理保存、突增密度、關閉清除、重連丟棄舊批次、減少動態效果、橫式／直式來源、160 字長留言、頁內全螢幕、44px 控制、無水平溢出及零 page errors。詳見 `danmaku-browser-evidence.json` 與 `danmaku-*.png`；這不是正式登入／外部影音端到端測試。
- 單元測試驗證重複事件、queue 大小／到期、初始與重連批次丟棄、私人設定和不合法貼圖／過長文字排除。
- 初次 DB runner 使用錯誤安全判斷欄位，測試被 skip，runner 正確標記 FAIL；修正為既有 `.safe` 後實測通過，未降低斷言。初次瀏覽器 harness 漏了真實排版／Tailwind 來源，修正 harness 後通過。初次 Prisma root DLL 被占用、來源鏡像缺 manifest；改獨立 client 並補 manifest 後型別檢查通過。收據保留先前失敗。

安全／效能／維護自查：參數化 SQL、活動鎖、雙 scope 查詢、白名單匿名 DTO、strict 輸入、常數上限、順序輪詢避免重疊、逾時／取消、不可變回答及具名共用元件；未新增外部依賴或角色系統。

`.github/workflows/ci.yml` 已於每次 push/PR 跑 ESLint、typecheck、單元測試與 coverage，包含 disposable DB 配置，沿用而不新增 Production 自動部署。未 push、未執行遠端 CI、未套用外部 migration 或部署。

## 尚未驗證、回滾與下一功能

未驗證實體 iPhone/Android、Safari、正式登入、外部影音與跨網路同步延遲。手機原生影片全螢幕不保證包含網頁彈幕，請使用既有頁內全螢幕。部署前須先由授權流程套用新增 migration，再產生 Prisma client；此 session 沒有部署授權。

回滾只撤除本次 UI 接線、API/domain、樣式與卡片限速／DB clock hunks；保留前序私密聊天、卡片與排版修改。資料庫欄位可留存並保持關閉，不需刪除任何回答或 migration 資料。不可把私人 source 或 visibility 改成公開來相容舊版。

下一功能若加入預設互動角色，必須另立來源標記與公開合約，不得塞入真人 response 或計入真實參與統計。

## 模式與 Checkpoint

已執行 ai-team-pro 切換，router 已更新；`.codex/config.toml` 寫入遭拒，完整設定切換未成功，未繞過權限或宣稱動態更換模型。工作目錄有大量前序未提交變更，本次只擁有上述新增檔及明列接線 hunks，不使用 `git add .` 納入未知工作。

已對本次明確新增檔執行精確清單的 `git add -- ...`；Git 回報無法建立 `.git/index.lock`（Permission denied），未 stage、未建立 commit，沒有 commit hash。未繞過 `.git` 限制；既有 dirty 變更與本次實作均保留在工作目錄，未 push／merge／部署。`git diff --check` 通過。
