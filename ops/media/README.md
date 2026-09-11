# 瀏覽器講師排版媒體服務

使用 [MediaMTX](https://github.com/bluenviron/mediamtx) v1.21.0，MIT 授權。使用原版執行檔／容器，不修改或內嵌 upstream 程式。官方發布包含 LICENSE，部署時保留。本專案的 canvas 合成器與 WHIP/WHEP JSON signaling adapter 為自行實作；沒有新增付費 SDK。

本機：使用官方 Windows/Linux/macOS 執行檔啟動 `mediamtx ops/media/mediamtx.local.yml`，將 Next.js 執行環境的非秘密設定 `CELEBRATEDEAL_MEDIA_ORIGIN` 設為 `http://127.0.0.1:18889`。不設定時功能 fail closed。不可將這份本機配置直接用於外部部署。

流程：活動管理 → 講師與 PPT → 改用瀏覽器直播 → 完成既有報名表／通知樣板等發布檢查，發布為 scheduled → 開啟攝影機與 PPT 分享 → 開始直播。建立成功的影音連線會將 scheduled 活動切為 live；停止傳送釋放媒體，但不自動結束活動，可重連，最終結束由既有活動管理操作。

此版本只提供即時直播，啟用時關閉該活動 replay/evergreen。原影片不刪除。既有 HLS、Cloudflare 外部推流與預錄播放沿用；不支援把已合成影片拆開重排，分離預錄素材同步目前亦未支援。

## 外部部署條件

- 使用專用、持續運作的 MediaMTX 主機；不能把媒體 daemon 放進 Next.js serverless function。
- signaling listener 只允許應用伺服器存取。反向代理不得公開 MediaMTX 的 WHIP/WHEP、內建網頁、API、HLS 或 RTSP；否則會繞過應用的租戶與觀眾入場限制。非 loopback origin 必須 HTTPS，私網／防火牆與實際拓樸需另外驗收。
- 為 WebRTC ICE 設定可達的 UDP/TCP 埠與公開位址。跨 NAT、公司網路可能需要 TURN，必須另做端到端測試；目前不宣稱跨網路已驗證。
- 保持 `overridePublisher: false`，避免第二位講師覆蓋正在直播的來源。按容量設定 maxReaders，主機與流量不是免費資源。
- 保留原發布檢查與觀眾 admission；客戶端每 20 秒 heartbeat，每次都重新驗證入場資格。每個身分／活動／方向限一條連線。DB lease 60 秒，`/api/cron/live-media` 每分鐘清理過期 provider session，排程由既有 CRON_SECRET 保護；失敗保留 closing row 重試。部署必須確保排程實際運作，停止 heartbeat 的惡意連線最多再等待 lease 與下一次成功清理，不宣稱零延遲撤銷。觀眾正常離場也會要求上游停止。
- 套用 migration 前備份並經既有發佈流程審核。不可自動操作正式資料庫、推流或部署。

## 回滾

停止此功能的傳送，活動來源選回原影片／Cloudflare 來源，移除 `CELEBRATEDEAL_MEDIA_ORIGIN` 即停用新推流。新 schema 欄位與 table 可保留，避免破壞性 migration；不要刪除原影片。
