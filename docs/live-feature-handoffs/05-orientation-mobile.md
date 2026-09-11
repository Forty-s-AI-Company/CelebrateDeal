# 05 橫式／直式直播與手機觀看

日期：2026-09-11
狀態：本機功能已實作；真機與外部上線驗證尚未完成。

## 完成範圍

- 建立／編輯活動的「媒體與 Live Input」可選橫式 16:9、直式 9:16，跟隨既有草稿版本保存及正式活動提交。舊資料缺少方向時維持橫式。
- 使用既有 `Live.presenterLayout` JSON 的 optional `orientation: landscape | portrait`，沿用 version 1 嚴格驗證；無新增 migration。仍需要前 04 的 presenterLayout migration，未套用至現用或外部 DB。
- 活動提交在既有交易列鎖內合併最新講師排版，只更新方向；直播狀態時拒絕方向變更。講師 API 不更改方向，並以 status 與舊 layout JSON 比對更新，防止舊分頁覆蓋新方向。
- 瀏覽器真直播採橫式 1920×1080／直式 1080×1920 canvas，30fps，使用原 WHIP／MediaMTX／WHEP。直式為完整簡報上方 45%、人像下方 55%，各自 contain，不重疊、不裁切；直式停用不適用的角落與大小控制。取得輸出後鎖定合成方向。
- 講師本機預覽、實際回傳監看與觀眾使用相同合成串流。預錄與外部已合成串流完整保留素材比例，比例不合時留白；不聲稱留白是重排，不提供已合成素材自動拆解。活動預覽顯示方向，常青預覽沿用完整比例；完整觀眾預覽透過既有公開頁入口。
- 所有來源的觀眾畫面使用 contain；手機直拿採影片上／互動下，橫拿及寬螢幕採左右區域，聊天與卡片不覆蓋播放器控制列。既有 checkout 小窗保留。
- 新增頁內全螢幕，播放器不重新掛載；支援退出按鈕、Escape、焦點循環及返回按鈕焦點、頁面捲動恢復。使用 visualViewport 高度／偏移、rAF 聚焦表單可見處理與 safe-area；畫面及表單可捲動。UI 提醒原生影片全螢幕可能無法顯示卡片／聊天。
- 本次沒有直播中切換比例、同時雙比例推流、去背、預錄素材拆分／重新合成。

## 主要檔案

- `src/lib/presenter-layout.ts`、`presenter-media.ts`：方向合約、幾何與輸出鎖定。
- `src/lib/live-studio-draft.ts`、`live-studio-draft-client.ts`、`src/app/actions.ts`：草稿／正式設定保存與既有排版保全。
- `src/components/live-stepper-form.tsx`、活動 edit/preview 頁、`evergreen-preview-player.tsx`：設定、還原及預覽。
- `src/app/api/live-presenter/route.ts`、`src/components/presenter-studio.tsx`：講師設定與真實畫面。
- 公開 `/live/[slug]` 頁、`live-playback.tsx`、新增 `live-viewing-shell.tsx`、`globals.css`：觀眾資料與裝置排版。
- `scripts/orientation-checks.mjs`、`orientation-disposable-qa.mjs`、`orientation-broadcast-qa.mjs`、`orientation-landscape-broadcast-qa.mjs`、`mobile-viewing-browser-qa.mjs`：可重跑本機證據。

## 實際驗證

| 驗證 | 實際結果與邊界 |
| --- | --- |
| `node scripts/orientation-checks.mjs` | 完整 TypeScript、指定檔 ESLint、18 檔 575 tests PASS。Prisma generated schema 與 canonical 相符，不重寫已鎖 DLL。見 [receipt](orientation-checks.json)。 |
| `node scripts/orientation-disposable-qa.mjs` | 真 PostgreSQL、canonical migrations、8 tests PASS；包含 portrait API 保存／還原、stale orientation CAS、租戶 FK、來源競爭及清理。僅自建 loopback disposable DB，清理 PASS。見 [receipt](orientation-db-evidence.json)。 |
| `node scripts/orientation-broadcast-qa.mjs` | 真 MediaMTX／WHIP／WHEP，講師監看及觀眾解碼均為1080×1920；像素驗證簡報完整、人像下方、4:3留白與設定還原。0 page errors。见 [receipt](orientation-broadcast-evidence.json)。 |
| `node scripts/orientation-landscape-broadcast-qa.mjs` | 真媒體傳輸，並排、四角、15%/35%、4:3內容保全、來源停止／恢復／釋放及設定還原等13項 PASS。見 [receipt](orientation-landscape-broadcast-evidence.json)。 |
| `node scripts/mobile-viewing-browser-qa.mjs` | Edge 模擬 viewport：390×844、844×390、768×1024、1440×900，各兩方向；8組排版／頁內全螢幕／卡片與聊天送出／縮可視區保留草稿 PASS。另2個合成 WebM 真解碼，640×360放直式活動、360×640放橫式活動 PASS。見 [receipt](orientation-mobile-browser-evidence.json)。 |
| `git diff --check` | PASS，僅 Git CRLF 換行提示。 |

已目視檢查講師合成與手機截圖。代表圖：[直式導播](orientation-broadcast-studio.png)、[直式活動完整保留橫片](orientation-mismatch-portrait.png)、[手機橫拿](orientation-mobile-portrait-844x390.png)。

上述瀏覽器皆本機桌面 Edge；viewport 縮小只模擬軟鍵盤可視區，不是觸控真機／真軟鍵盤。WebRTC 使用合成攝影機、簡報及音訊，auth/DB 為 harness 邊界；DB 有獨立真 PostgreSQL 測試，不能拼接宣稱完整登入＋真硬體＋外部部署 E2E。預錄 mismatch 使用本機 MediaRecorder 產生的真 WebM，API 為合成邊界。

未驗證：實體 iPhone／Android、iOS Safari、真瀏海／系統輸入法、原生全螢幕實機返回、外部 Cloudflare 串流／跨網路 NAT/TURN、現用 DB 與正式登入。媒體主機部署條件沿用 `ops/media/README.md`，不宣稱 production ready。

過程：首次 unit 因新增公開 orientation DTO 與前04新增 browser_live 來源的精確預期未更新而失敗；補齊預期與新增行為測試後575項通過，未降低 assertion。首次直式 QA 缺少新 temp 目錄，補 mkdir 後通過。曾遇瀏覽器預設 profile 啟動限制，改為明確 workspace 臨時 profile；不使用使用者瀏覽器資料。

## 自查、CI 與交接

安全：沿用 manager／tenant／CSRF／admission，方向嚴格白名單；私人聊天及卡片事件與可見性合約未改。效能：沿用單一路30fps合成與播放器、viewport更新使用rAF，不重建媒體或輪詢。可讀性／維護性：方向共用既有JSON、單一幾何函式與觀看shell，重要邏輯有註解。

既有 `.github/workflows/ci.yml` 已在 push/PR 執行 ESLint、typecheck、單元測試與coverage，沿用；沒有新增自動 production deployment。沒有 push、merge、部署、正式推流、讀取秘密或操作外部資料庫。

已讀 AGENTS、session guide、構想、02／04 handoff 及本機 Next.js use-client/forms 文件。ai-team-pro router 已套用；`.codex/config.toml` 寫入遭拒，未宣稱模型設定完整同步或使用未提供的 Claude。本次主代理處理設定與合成；一名獨立子代理僅處理手機觀看scope，沒有重複探索全專案。

回滾：只撤回本次方向欄位接線、portrait幾何分支與watching shell，保留既有01–04工作及DB資料；缺少方向仍落在landscape。保留stale layout CAS可避免覆蓋。不得整檔還原共享dirty檔。

下一功能：去背若接入攝影機，只處理camera區；必須沿用方向尺寸、contain簡報及媒體track生命週期。彈幕與角色內容不得把私人聊天送入公開顯示，也不能覆蓋手機送出區。

## Checkpoint

工作開始前已有大量01–04與團隊設定的未提交變更，均保留；只嘗試本輪明確ownership的精確stage。Git結果於交付前記錄於此，不將未知變更納入commit。

已執行精確的 git add -- docs/live-feature-handoffs/05-orientation-mobile.md；Git 無法建立 .git/index.lock，回報 Permission denied。因此未 stage、未建立 checkpoint commit，沒有 commit hash；未繞過權限。程式、測試與文件均保留於工作目錄。另以 .gitignore 精確排除本輪 tmp/mobile-viewing、tmp/orientation-checks、tmp/orientation-media 產物與合成瀏覽器 profile。
