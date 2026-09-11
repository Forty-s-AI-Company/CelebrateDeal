# 04 講師與 PPT 排版

日期：2026-09-11

狀態：LOCAL_IMPLEMENTED_AND_VERIFIED。基本排版與真實本機影音傳輸已實作並驗證；尚未部署媒體主機、套用現用資料庫 migration 或取得真機／跨網路 release evidence。

## 功能與整合

入口：直播間管理 → 講師與 PPT。

- PPT 左、攝影機右並排；子母畫面四角與 15%–35% 大小。
- 設定儲存與還原；本機預覽、真正 WHEP 回傳監看與觀眾頁入口。
- 1920×1080／30fps canvas，保持素材比例；互動卡片與主要操作在影片外。
- 授權拒絕、來源 mute/ended、停止分享、晚到非同步結果及卸載均有清理；觀眾連線失效顯示重試。

使用免費開源 [MediaMTX v1.21.0](https://github.com/bluenviron/mediamtx/releases/tag/v1.21.0)，MIT 授權，保留 [LICENSE](../../ops/media/LICENSE.mediamtx)。官方 Windows artifact SHA-256 已比對 release digest，見 [receipt](presenter-mediamtx-artifact.json)。沒有新增付費 SDK；主機與頻寬仍有成本。

原架構為外部合成來源 → Cloudflare/HLS，缺少產品內攝影機、合成與傳送端。本次新增 opt-in browser_live：攝影機＋PPT 螢幕分享 → canvas／麥克風 → WHIP → MediaMTX → WHEP → 既有觀眾播放器。設定與 signaling 使用同源應用 API，並非靜態預覽交付。

切換時建立新 Video、保留原 Video，關閉該活動 replay/evergreen；本版沒有錄影。既有 HLS／預錄沿用。已合成影片不可拆開；分離預錄素材尚無同步合約，介面明示不支援。去背與完整直式導播不在範圍。

## 主要合約與檔案

- presenter-layout.ts：版本化嚴格 schema、穩定預設、四角與 contain 幾何。
- presenter-media.ts、presenter-studio.tsx：合成、來源生命週期、設定與回傳監看。
- /lives/[id]/presenter：manager 限定入口。使用完整文件導覽，讓限定講師頁的 camera/microphone/display-capture Permissions Policy 生效。
- /api/live-presenter：租戶限定設定；啟用限開播前，transaction 比對原 status/videoId，競爭時回滾新來源。
- /api/live-media：同源 JSON、CSRF／rate limit；publisher/monitor 管理權限；viewer 每次 offer/heartbeat/stop 重新驗證 admission。不暴露上游 URL。
- live-media-client.ts、live-media-provider.ts、live-media-receiver.tsx：ICE／請求 timeout、失效提示、停止與晚到 session 清理。
- Live.presenterLayout、LiveMediaSession：租戶複合 FK，活動／身分／方向唯一；60 秒 lease、20 秒 heartbeat。清理 CAS claim closing，防止續租競爭；失敗保留重試。
- /api/cron/live-media：既有 cron secret 保護、每分鐘清理；每次最多 20 筆、4 筆並行。正常觀眾離場也關閉 session。撤銷依賴排程與上游成功，非即時保證。
- prisma/migrations/20260911020000_presenter_layout/migration.sql：additive migration，只在 disposable DB 套用。

## 驗收證據

| 命令／驗收 | 結果 |
| --- | --- |
| node scripts/presenter-checks.mjs | PASS：完整 typecheck、指定變更 ESLint、12 檔 151 tests；已生成 Prisma schema 與 canonical 一致。[證據](presenter-checks.json) |
| node scripts/presenter-disposable-qa.mjs | PASS：真正 PostgreSQL canonical migrations、6 項設定還原／租戶 FK／並行唯一／lease claim／來源 CAS；DB 清理成功。[證據](presenter-db-evidence.json) |
| node scripts/presenter-browser-qa.mjs | PASS：真正 MediaMTX、WHIP/WHEP、應用 routes 與 UI，13 項檢查、0 page errors。[證據](presenter-browser-evidence.json) |
| 觀眾實際解碼像素 | 並排、四角、15%/35% 邊界、4:3 PPT 在 16:9 串流保全比例 PASS |
| 來源生命週期 | 單元驗證拒絕／晚到／卸載；瀏覽器驗證停止分享遠端清空、重分享恢復、停止釋放 tracks、失聯可重試 |
| 設定與互動 | UI 保存還原、講師回傳監看、手機比例及卡片在影片外 PASS |
| git diff --check | PASS，只有 CRLF 提示 |

截圖已檢視：[講師](presenter-studio.png)、[手機觀眾](presenter-viewer-mobile.png)。

瀏覽器使用 headless Edge、合成攝影機／PPT／音訊；auth/DB 為 harness 邊界。DB 另有真正 PostgreSQL 測試，該測試 auth/provider 為合成邊界。未宣稱真硬體＋實際登入＋現用 DB＋跨網路整體 E2E 完成；Safari、NAT/TURN 與主觀文字清晰度尚待實機驗收。

過程曾遇 Windows TLS、Prisma DLL 鎖定及初次 UI label 定位失敗，分別改用 Node 驗證官方下載、確認已生成 schema 一致、補明確 aria-label 後通過最終檢查，未降低 assertion 或停止未知服務。

## 審查、部署、回滾

完成安全、效能、可讀性、可維護性自查與獨立 Terra reviewer 審查；未使用 Claude。已修正 session 無界／過期清理缺口、續租競爭、清理失敗重試；最後審查無新 high/medium。清理串行延遲建議改有界批次後，DB 與 targeted checks 再次通過。

部署條件見 [ops/media/README.md](../../ops/media/README.md)：套用 migration、專用持續運作 MediaMTX、設定 CELEBRATEDEAL_MEDIA_ORIGIN、私有 signaling、可達 ICE 與成功運作 cron。不可直接公開本機配置或將 daemon 放進 serverless function；未設定 origin 時 fail closed。

既有 .github/workflows/ci.yml 已在 push/PR 跑 ESLint、unit/coverage 與互動測試，沿用。未新增自動 production deployment，未讀取 secrets、操作正式 DB 或正式推流／部署。

回滾：停止傳送，來源選回保留的原 Video／Cloudflare，取消 media origin；保留 additive schema，避免破壞性 migration。不要整檔還原含前 01–03 工作的共享檔案。

已遵守 AGENTS、session guide、構想與本機 Next.js 文件。ai-team-pro router 已切換，但腳本寫 .codex/config.toml 遭拒，未宣稱原生模型設定完整同步。既有大量未提交內容全部保留。Git checkpoint 受 .git/index.lock 寫入權限阻擋，沒有 commit hash；部署驗收與 checkpoint 尚待相應環境完成。
