# Cloudflare Stream 簽章播放網址評估（F-093／B06-07）

狀態：評估，未實作。本文件只描述做法、影響與成本，程式與 Cloudflare 設定都沒有變更。

資料來源（2026-10-21 讀取）：

- Cloudflare Stream「Secure your Stream」：<https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/>
- Cloudflare Stream「Pricing」：<https://developers.cloudflare.com/stream/pricing/>
- Cloudflare Stream「Start a live stream」：<https://developers.cloudflare.com/stream/stream-live/start-stream-live/>

## 1. 現況與問題

| 位置 | 現況 |
|---|---|
| `src/lib/cloudflare-stream.ts` `createDirectCreatorUpload`、`createResumableCreatorUpload` | 建立上傳時沒有設定 `requireSignedURLs`，也沒有 `allowedOrigins` |
| `src/lib/cloudflare-stream.ts` `createLiveInput` | `recording: { mode: "automatic" }`，錄影沒有 `requireSignedURLs` |
| `src/lib/cloudflare-stream-webhook-handler.ts:47,69,204`、`src/lib/cloudflare-ops.ts:316,363` | 一律把 `https://videodelivery.net/<uid>/manifest/video.m3u8` 寫進 `Video.videoUrl` |
| `src/lib/live-playback-source.ts` | 入場檢查通過後回傳 DB 裡的 `videoUrl` 原值 |
| `src/app/api/stream-usage/route.ts` | 用量靠瀏覽器心跳回報 |

影響：

- 網址本身永久有效、不需簽章，任何拿到網址的人（分享、開發者工具）都能不經入場、不報名、不計額度觀看。
- Cloudflare 依實際遞送分鐘向平台收費，這些觀看不會進入商家額度（`StreamUsageLedgerEntry`），成本由平台吸收。
- 付費回放、限時回放（`replayAvailableUntil`）的存取控制只在我們的頁面上，對網址本身無效。

## 2. Cloudflare 提供的機制

### 2.1 `requireSignedURLs`

- 影片欄位 `requireSignedURLs: true` 後，公開網址（含 `customer-<CODE>.cloudflarestream.com/<VIDEO_ID>/watch` 與內建播放器）一律拒絕，必須帶 token。
- 既有影片以 API 更新：`POST https://api.cloudflare.com/client/v4/accounts/{account_id}/stream/{video_uid}`，body `{"uid": "<VIDEO_UID>", "requireSignedURLs": true}`。
- Live input 的 `recording` 物件同樣有 `requireSignedURLs` 與 `allowedOrigins`，會套用到該 input 錄下的所有影片；透過 live input id 觀看時，input 層設定優先於影片層。

### 2.2 產生 token 的三種方式

| 方式 | 端點／作法 | 適用 | 限制 |
|---|---|---|---|
| `/token` API | `POST /accounts/{account_id}/stream/{video_uid}/token`，可帶 `exp`、`downloadable`、`accessRules` | 測試或每日少於約 1,000 個 token | 每個 token 一次 API 呼叫，受 rate limit；預設效期 1 小時；不支援 Live WebRTC |
| Workers binding | `env.STREAM.video(id).generateToken()` | 跑在 Workers 上的服務 | 我們的應用在 Vercel，不適用 |
| 自簽 JWT（signing key） | 先 `POST /accounts/{account_id}/stream/keys` 取得 `id`、`pem`、`jwk`（只顯示一次）；之後在伺服器以 RS256 簽 JWT，header 帶 `kid`，claims：`sub`（video uid）、`kid`、`exp`、`nbf`、選用 `accessRules`、`downloadable` | 高流量、Live WebRTC、自訂存取規則 | `exp` 最多簽發後 24 小時；最多 1,000 把 key；`DELETE /stream/keys/{key_id}` 撤銷後該 key 簽的 token 全部失效 |

`accessRules` 最多 5 條，依序比對（`any`、`ip.src`、`ip.geoip.country`；`allow`／`block`），沒有命中視為有效。IP 規則在觀看期間會重新評估，對行動網路容易誤擋，不建議綁 IP。

### 2.3 播放網址格式

把網址中的 video id 換成 token：

- HLS：`https://customer-<CODE>.cloudflarestream.com/<TOKEN>/manifest/video.m3u8`
- DASH：`https://customer-<CODE>.cloudflarestream.com/<TOKEN>/manifest/video.mpd`
- 內建播放器：`https://customer-<CODE>.cloudflarestream.com/<TOKEN>/iframe`

### 2.4 `allowedOrigins`

- 影片欄位 `allowedOrigins`（網域陣列），也套用在自建播放器對 manifest 與 segment 的請求。
- `*.example.com` 只匹配子網域、不含裸網域；`example.com` 不匹配 `www.example.com`；不支援路徑；`localhost` 需寫明連接埠（80／443 除外）。
- 與簽章網址合用時，同時限制「誰能看」與「網址能在哪裡播」。

## 3. 建議流程（入場後簽發短效播放 token）

採自簽 JWT：每位觀眾每次入場都要一個 token，`/token` API 的每日量與 rate limit 不夠；自簽不需要對 Cloudflare 發請求。

1. **金鑰**：owner 在 Cloudflare 建一把 signing key，`id` 與 `pem` 存成 Vercel 環境變數（例如 `CLOUDFLARE_STREAM_SIGNING_KEY_ID`、`CLOUDFLARE_STREAM_SIGNING_KEY_PEM`），各環境（Preview／Staging／Production）用不同的 key。輪替：先建新 key 並部署，舊 key 等到最長 token 效期過後再 `DELETE`。
2. **儲存**：`Video` 另存 `cloudflareVideoUid`（或沿用 `cloudflareLiveInputUid`），`videoUrl` 不再是可直接播放的網址；`customer-<CODE>` 子網域放設定（`CLOUDFLARE_STREAM_CUSTOMER_CODE`）。
3. **簽發**：`/api/live-playback-source` 在 `hasActiveLiveViewerSession` 通過、live 與影片都屬於同一 vendor 之後，以 `sub = video uid`、`nbf = now - 30s`、`exp = now + 10 分鐘` 簽 JWT，組出 `customer-<CODE>.cloudflarestream.com/<TOKEN>/manifest/video.m3u8` 回傳。token 不寫進 DB、不寫進 log。
4. **續期**：HLS 播放器在播放期間會持續抓 manifest 與 segment。觀眾端目前每 30 秒重新入場（`/api/live-admission`）；token 到期前（例如剩 2 分鐘）重新呼叫 `/api/live-playback-source` 取得新網址並以 `hls.loadSource` 平順切換（Safari 原生 HLS 需換 `src`，要在播放位置上補 seek）。也可把 token 效期拉長到 30–60 分鐘以降低切換次數，代價是被轉傳時可用時間較長。
5. **限時回放**：`exp` 取 `min(now + 10 分鐘, replayAvailableUntil)`，回放截止後網址自然失效。
6. **計量**：遞送分鐘仍以 Cloudflare 帳單為準；我們的心跳帳本只拿來分攤給商家。簽章後只有經過入場的人拿得到網址，心跳與實際遞送的落差主要剩下「觀眾關閉心跳但繼續播放」，可在 `StreamUsageReconciliation` 對帳時監看。
7. **allowedOrigins**：新影片與 live input 錄影設 `allowedOrigins` 為正式網域與 Preview 網域（需確認 Vercel Preview 網域是否能用萬用字元涵蓋），本機開發另用不設 `allowedOrigins` 的測試影片。

### 3.1 程式改動範圍（實作時）

- `createDirectCreatorUpload`、`createResumableCreatorUpload`：上傳參數加 `requireSignedURLs: true`、`allowedOrigins`。
- `createLiveInput`：`recording: { mode: "automatic", requireSignedURLs: true, allowedOrigins: [...] }`。直播中（非錄影）的 live input 播放也要確認同樣需要 token，要在 Sandbox 帳號實測。
- `cloudflare-stream-webhook-handler.ts`、`cloudflare-ops.ts`：不再寫 `videodelivery.net/<uid>` 網址，改存 uid。
- `live-playback-source.ts`：簽發 token、組網址；新增 `src/lib/cloudflare-stream-signing.ts`（RS256、`kid`、時鐘偏移容忍）。
- `live-playback.tsx`：`isHlsPlaybackUrl` 允許 `customer-<CODE>.cloudflarestream.com`；加入到期前換網址。
- CSP：`media-src`／`connect-src` 加 `https://customer-<CODE>.cloudflarestream.com`（目前只有 `videodelivery.net`）。
- 測試：簽章格式與 claims、跨租戶不簽、未入場不簽、回放截止、續期切換。

## 4. 既有影片批次更新

1. 盤點：從 DB 取 `Video` 中 `sourceType` 為 Cloudflare 上傳或 live input、且 `videoUrl` 以 `https://videodelivery.net/` 開頭的列，取得 uid 清單（唯讀查詢，需 owner 授權連正式資料庫）。
2. 先部署「可簽章」的程式（第 3 節），但先不開 `requireSignedURLs`：此時新舊網址都能播，確認簽章網址在 Staging 與 Production 都能播放。
3. 以腳本逐支呼叫 `POST /stream/{video_uid}`，body `{"uid": "...", "requireSignedURLs": true, "allowedOrigins": [...]}`；每支之間限速、失敗重試、輸出結果清單（只含 uid 與狀態）。live input 另外以 live input 更新 API（`/stream/live_inputs/{uid}`，HTTP 方法實作前再對照 API 參考確認）更新 `recording.requireSignedURLs`。
4. 抽樣驗證：舊的 `videodelivery.net/<uid>/manifest/video.m3u8` 應被拒絕；經入場取得的簽章網址可播放。
5. 回滾：把同一批影片的 `requireSignedURLs` 改回 `false` 即恢復公開網址；程式端簽章網址在兩種設定下都能播放，所以回滾不需要重新部署。
6. 已經流出去的舊網址在第 3 步之後立即失效；正在觀看的人若還在用舊網址會中斷，建議避開直播時段執行。

## 5. 成本

| 項目 | 金額 | 說明 |
|---|---|---|
| 儲存 | USD 5／1,000 分鐘容量／月（預付） | 不因簽章改變；live input 錄影也計入 |
| 遞送 | USD 1／1,000 分鐘（後付） | 簽章後只有入場觀眾能看，可減少未授權觀看造成的遞送費 |
| 簽章、token | 價格頁未列費用 | 自簽 JWT 不呼叫 Cloudflare API；`/token` API 有 rate limit |
| 直播輸入、編碼 | 免費 | 無觀眾的直播不產生遞送費 |
| 工程 | 約 2–3 人天 | 簽章模組、播放來源、播放器續期、CSP、測試；另加 Staging 實測與批次更新 0.5 人天 |
| 營運 | 金鑰保管與輪替 | 需新增 2 個環境變數與輪替步驟 |

## 6. 風險與待決

- **owner 決策**：封測是否包含付費或限時回放。若只有免費直播，可先只做 `allowedOrigins`（不需簽章、只改設定），擋掉其他網站嵌入。
- **續期中斷**：token 到期換網址時，Safari 原生 HLS 可能短暫卡頓；需在實機驗證。
- **live input 直播中的播放**：文件說明 `recording.requireSignedURLs` 套用到錄影；直播進行中以 live input 播放時是否同樣要求簽章，需在 Sandbox 帳號實測後再定。
- **Preview 網域**：`allowedOrigins` 不支援路徑，Preview 網域若無法以萬用字元涵蓋，需要 Preview 專用影片。
- **時鐘偏移**：`nbf` 往前 30 秒，避免伺服器與 Cloudflare 時間差造成剛簽發就無效。
