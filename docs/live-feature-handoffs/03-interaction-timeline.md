# 03 預錄互動時間觸發

## 完成範圍

沿用 02 的 LiveInteractionRun／LiveInteractionResponse 與互動卡片 API、講師控場、私人回答規則；未另建題目系統、未變更 Prisma schema 或新增 migration。既有互動腳本及時間字串解析器保留，排程 UI 復用 `parseInteractionTriggerSeconds`。

講師可替待發卡片設定出現／持續時間、預覽指定時間是否顯示、調整、保存與停用；時間接受整數秒、MM:SS、HH:MM:SS。前後端驗證非負起點、至少 1 秒持續、整數與上限 24 小時，且不得超過目前租戶影片長度。每活動最多 100 個啟用排程。講師清單保留最近 100 題及所有啟用排程／目前手動題，避免舊排程被新題擠掉而無法結束。

## 實際播放模式

| 模式 | 本次支援與依據 |
| --- | --- |
| 一般同步預錄 `streamMode=vod`、runtime playing | 支援。沿用 `resolveLiveRuntime`，伺服器以活動 scheduledAt 與現在時間計算共同位置；晚加入者僅呈現當下時間窗內的一題。個人暫停／跳轉不改變全場時鐘。 |
| 既有活動回放 runtime replay | 支援個人播放。直接觀察現有 `LivePlayback` 的 HTMLVideoElement.currentTime，沒有以頁面開啟秒數替代播放進度。 |
| 固定場次常青預錄 | 支援已持久化 `evergreenSessionStartAt` 的共同時間。與公開頁 `getEvergreenPlaybackState` 的 fixedStart 優先規則相同。 |
| 未固定場次的常青 JIT／daily／on_demand | 本次不宣稱支援。現有公開頁動態推算場次，但 admission 沒有持久化相同的觀眾 cohort；而 on_demand 的現有播放器仍受共同時鐘校正、隱藏個人控制，不能當作完整個人播放模式。API 拒絕啟用排程，UI 明示缺口。補齊持久化場次與播放器／來源 API 一致性後才可開放。 |
| 真直播 `streamMode=live` | 保留手動發題，拒絕啟用影片排程；以前保存的排程亦不投影、不接受回答。直播結束後不能再 start、新增回答或顯示 active 手動題；相同既有回答的重送仍回原紀錄。 |

沒有新增獨立的隨選課程播放器，也未將既有 course-player 冒稱為活動互動卡片模式。

## 排程與回答合約

`configuration` 保持 version 1，可選新增 `schedule: { enabled:boolean, startSeconds:number, durationSeconds:number }`。建立卡片時不可夾帶 schedule，必須使用有影片與活動驗證的 `action=schedule`。設定仍在原 run JSON 中保存。

排程題維持 draft：可見性依目前播放位置推導，不將某一觀眾的播放進度寫成全場 active。`startsAt/endsAt` 仍只代表既有手動生命週期，不能當成影片秒數。讀取不發送或補播 `card.started` 事件。GET 保留 `card` 手動卡片，新增 `timeline: { clock: {mode, positionSeconds}, cards }`；cards 只含可啟用的題目及本人 ownValue，不含他人答案／統計／身分。講師 GET 新增 timelineCapability。

有效時間為 `[startSeconds, startSeconds + durationSeconds)`。重疊時選最晚開始的一題，同時開始以 ID 穩定排序；沒有事件佇列，不補發已過期題目。先前被遮住的題目若仍有效，可在另一題結束後恢復。手動 active 題永遠優先；結束後只恢復當下有效排程。手動發送某張排程題會停用該題排程，沿用原手動生命週期。講師可「結束此排程題目」永久 close，也可「停用排程」保留後續調整／再啟用能力。

個人回答 POST 可含 positionSeconds，伺服器僅在可信活動 runtime=replay 時採用，並驗證對應時間窗、手動衝突、租戶、活動、題目與回答。同步預錄完全忽略瀏覽器聲稱的秒數，使用伺服器時鐘。個人媒體時間是瀏覽器進度聲明，可由觀眾自由 seek，也可被修改；本功能不把它當觀看完成證明、考試防作弊或發獎依據。

回答仍使用 `(runId, participantHash)` 唯一鍵；同值重送回原回答，不同值回 409。倒轉、重播、重新整理及重連皆沿用同一 admission 身分的原回答，不重複計算。卡片回答不產生一般聊天室／彈幕資料。所有写入沿用活動列鎖；唯讀快照用 RepeatableRead，避免全場輪詢搶同一寫入鎖。

## 播放器與恢復行為

- HTML video 的 loadedmetadata、timeupdate、play、pause、seeking、seeked、ended、emptied、ratechange 與 visibilitychange 都重新讀取實際 currentTime。
- 個人暫停維持原影片位置；seeking／ended／未載入媒體先隱藏排程。快轉只選新位置有效題，倒轉／重播可再次顯示同題及原回答。
- 每 1.5 秒取得快照、100ms 更新可見性；重連及背景恢復先丟棄舊租約，重新讀取。背景不啟動新輪詢。序號防止舊 response 覆蓋新快照；四秒租約失效後隱藏，避免離線持續展示。
- 同步位置以回應收到時間為 monotonic anchor，RTT 作為時間不確定上界。只有下界與上界都選中同一題才顯示；靠近邊界可保守提早隱藏，不把晚到的過期問題補出來。伺服器最終再驗證回答時間。
- 播放來源不可用、容量耗盡、未准入、離開可播放狀態或進入結帳時，停用觀看卡片。沿用現有 playsInline；未宣稱手機原生全螢幕可疊加網頁卡片。

## 相關檔案

- `src/lib/interaction-card-contract.ts`、`interaction-card.ts`：配置、儲存、權限與回答。
- `src/lib/interaction-card-timeline.ts`、`interaction-card-media.ts`：可注入時鐘、單題選擇、網路延遲界線及媒體事件。
- `src/app/api/live-interactions/cards/route.ts`：沿用准入、owner/admin、同源、限流、no-store。
- `src/components/interaction-card-schedule.tsx`、`instructor-interaction-cards.tsx`：編輯、預覽、保存與結束。
- `src/components/live-interaction-card.tsx`、`live-playback.tsx`：真實播放器整合與恢復。
- `src/lib/interaction-card-timeline*.test.ts`、`scripts/interaction-timeline-*-qa.mjs`：deterministic、真 PostgreSQL 與真播放器測試。

## 實際驗證

- 8 個測試檔、145 項 targeted tests 全數通過，涵蓋時間格式、時間窗、重疊、快轉／倒轉／重播、暫停、媒體事件、RTT 過期邊界、既有卡片／腳本／播放器／互動 API 回歸。
- `node scripts/interaction-timeline-disposable-qa.mjs`：本功能 6 項＋既有卡片 5 項，共 11 項真 API/domain/PostgreSQL 測試通過，無 skipped。含排程調整與停用、超過片長、兩名觀眾、並行重送、跨租戶／活動、未登入／會計／owner、同步與個人回答、手動衝突、真直播切換及結束。只使用原先不存在的 loopback disposable DB，完整 migrations 與 marker 驗證後清除。auth 與 limiter 為合成邊界。證據：`interaction-timeline-db-evidence.json`。
- `node scripts/interaction-timeline-browser-qa.mjs`：真 LivePlayback、HTML video 解碼合成 WebM 影片及真卡片元件，Edge 桌面驗證六組情境通過、pageErrors=0。API 與無關側欄是合成邊界；不是正式服務 E2E。證據：`interaction-timeline-browser-evidence.json`。
- 全專案 `tsc --noEmit`、本次相關 TS/TSX/QA scripts ESLint、`git diff --check` 通過。沿用現有路由，未新增 Next route。
- 初次 DB fixture 漏填 videoUrl、第二次合成 admission 憑證格式不符，修正 fixture 後通過；失敗紀錄保留，未減少 assertion。初次瀏覽器測試的合成影片服務未提供 Range，seek 等候逾時；補上 Range 後驗證通過。
- Terra 獨立唯讀審查確認資料隔離，提出唯讀鎖競爭、延遲邊界與真直播結束規則，均已修正並測試。固定常青與個人媒體時間的限制如上。未執行 Claude 審查，沒有宣稱使用未提供的模型。

## CI、限制與回滾

沿用 `.github/workflows/ci.yml` 的 push／PR ESLint、typecheck 與單元測試，未新增自動 Production 部署。未 push、merge、部署或操作正式服務。未驗證實體 iPhone／Android、Safari、外部 HLS 網路實播、正式登入及大規模壓測；播放器瀏覽器測試使用本機合成媒體。

回滾僅撤除此輪 schedule 配置／API 分支、播放器事件接線與新 UI，保留原始卡片與回答；不得刪除 response 或將私人回答改為公開。JSON schedule 可保留為資料，但回滾舊 strict schema 前須保留 optional schedule 解析相容性，或另做已核准的精確資料轉換；不得直接讓舊解析器拒絕既有卡片。

下一功能可沿用此播放器 ref 與卡片容器。若要支援浮動常青場次，先補齊公開頁、playback-source、admission 與 server clock 共用的持久化場次合約。

## 模式與 Checkpoint

依要求執行 ai-team-pro 切換；router 已更新，`.codex/config.toml` 寫入遭權限拒絕，未繞過，也未宣稱切換目前模型或推理設定。進場時已存在前兩項功能及 AI team 的大量未提交變更，本輪保留它們，僅對必要共用檔案擴充。

所有驗證完成後，已對本輪新增檔案使用明確清單執行 `git add -- ...`。Git 回報 `.git/index.lock: Permission denied`，因此沒有 stage 或建立 commit，沒有 commit hash。未繞過權限，亦未將前兩項功能的未知既有變更納入提交。程式與交付證據保留在工作目錄。
