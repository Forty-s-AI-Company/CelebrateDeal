# Cloudflare Stream 簽章播放網址評估（F-093／B06-07）

狀態：**已實作（2026-11-03，分支 `ai/stream-signed-urls`）**，以環境變數逐環境開啟。程式已能簽章；各環境的 Cloudflare signing key、環境變數與既有影片批次更新仍待 owner 依第 8 節執行。第 1–6 節保留原評估內容，實作與評估不同之處見第 7 節。

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

## 7. 實作摘要（2026-11-03，含審查修正）

| 項目 | 實作 |
|---|---|
| 設定 | `src/lib/cloudflare-stream-signing-config.ts`：金鑰解析（PEM／Cloudflare base64 pem／JWK）、`allowedOrigins`、`CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS`。不簽 token，供 preflight 與上傳程式讀取 |
| 簽章 | `src/lib/cloudflare-stream-signing.ts`（`server-only`）：RS256 自簽 JWT，header `{ alg, kid }`，claims `sub`、`kid`、`nbf = now − 30 秒`、`exp`；不帶 `accessRules`（不綁 IP）。token 不寫 DB、不寫 log |
| 租戶綁定 | 只簽 `sourceType` 為 `cloudflare_stream`／`cloudflare_live` 的 Video 列，且呼叫端必須傳入目前 vendor（與列的 `vendorId` 不同就不簽）。`sub` 只能是同一列由伺服器寫入的 `cloudflareStreamUid`／`cloudflarePlaybackId`／`cloudflareLiveInputUid`；網址中的 uid 與欄位不一致時原樣回傳、不簽。商家可自填的 `url` 類型即使貼了 Stream 網址也一律不簽，避免替其他租戶的影片簽 token |
| 效期 | 直播（含 evergreen、指定場次播放中）10 分鐘；回放 30 分鐘；後台預覽、縮圖與報名頁宣傳影片 4 小時；一律不超過 24 小時。回放的 `exp` 不超過 `replayAvailableUntil`，指定場次再取該場次的回放期限（`fixedSessionReplayAvailableUntil`）；期限已過時不簽、回 403 |
| 播放來源 | `src/lib/live-playback-source.ts`：入場、vendor／live 綁定與 runtime 檢查都通過後，把該列傳進簽章函式；回應多一個 `expiresInSeconds` |
| 續期 | `src/lib/signed-playback-renewal.ts`、`src/lib/hls-playback-attachment.ts`、`src/components/live-playback.tsx`：hls.js 只要 `Hls.isSupported()` 就優先使用，原生 HLS 只在不支援時使用。到期前 2 分鐘（短效 token 取一半效期）重新呼叫 `GET /api/live-playback-source`（同樣要通過入場）；hls.js 以 `xhrSetup` 把之後每個請求的 token 換成最新的，原生 HLS 換 `src` 後補回播放位置。續期失敗時只要播放器還掛著就以 15 秒起倍增、上限 5 分鐘持續重試。播放中遇到 hls.js `NETWORK_ERROR` 401／403，或原生 `error`（網路／來源錯誤）時立刻續期。hls.js 只呼叫 `startLoad(原位置)`（`xhrSetup` 已把之後的請求換成新 token；不呼叫 `loadSource`，它會重新 attach media 讓播放位置歸 0），原本在播放而被暫停時補 `play()`；原生 HLS 換 `src` 並補回位置，換網址前與卸載時取消尚未觸發的 `loadedmetadata` 監聽。續期造成的播放不送 `video_play` |
| 上傳與 live input | `src/lib/cloudflare-stream.ts`：簽章啟用**且** `CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS=true` 時，direct upload body、tus `Upload-Metadata`（`requiresignedurls`、`allowedorigins`）與新 live input 的 `recording` 才帶 `requireSignedURLs: true`＋`allowedOrigins`；否則請求內容與之前完全相同 |
| `allowedOrigins` | `NEXT_PUBLIC_APP_URL` 的主機名（非預設連接埠時含 `:port`），加上 `STREAM_ALLOWED_ORIGINS`（逗號分隔，可用 `*.example.com`） |
| 既有影片 | `POST /api/admin/ops/cloudflare/require-signed-urls`（`JOB_SECRET`）：`mode` 為 `lock`（預設）或 `unlock`；一次一個 vendor、只處理 Cloudflare 類型、uid 只取上述欄位、每批最多 5 支、`id` 游標分頁、預設 dry-run，`maxDuration` 300 秒。lock 的 `apply` 需已設定金鑰（否則 409）；unlock 不需金鑰，送 `requireSignedURLs: false`、`allowedOrigins: []`（live input 錄影同樣清空），回到鎖定前的公開狀態。live input 先 `GET` 目前設定，只改 `recording` 的兩個欄位再 `PUT`。`apply` 後寫一筆稽核（`cloudflare_stream.require_signed_urls`／`cloudflare_stream.allow_public_urls`，只含 vendor、模式、videoId、uid 與結果）；稽核寫入失敗時回 207、`audited: false` 並記錯誤；Cloudflare 設定錯誤中斷批次時，先把已完成的結果寫入稽核再回錯誤 |
| 其他位置 | 商家後台影片預覽、直播預覽（另檢查 `live.video.vendorId`）、影片清單、影片編輯頁與互動腳本的縮圖（`thumbnails/thumbnail.*`；編輯頁只用簽章網址顯示，表單仍送出原本的縮圖網址）、`GET /api/media/videos/status` 回傳的縮圖、公開報名頁宣傳影片（以表單的 vendor 簽章）都改成傳 Video 列簽章。`GET /api/admin/ops/cloudflare/direct-upload` 在影片 ready 且簽章啟用時回傳 10 分鐘簽章網址，`scripts/staging-stream-resource-smoke.mjs` 改用它驗證播放（檢查 token 的 `sub` 是這次上傳的 uid） |
| preflight | 未設定金鑰：WARN；金鑰不完整、無法解析、非 RSA 或小於 2048 bits、`STREAM_ALLOWED_ORIGINS` 含無效項目、`CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS` 不是 true／false 或在沒有金鑰時設 true：FAIL；有金鑰但未鎖新上傳：WARN。執行期若發現設定錯誤，記一次 `stream_signing_misconfigured`（只含原因代碼）並回傳未簽章網址 |
| CSP | report-only 的 `media-src` 加 `https://*.cloudflarestream.com`；`connect-src` 加 `https://videodelivery.net`、`https://*.cloudflarestream.com` |

與第 3 節評估不同之處：

- **不改 schema**：第 3 節第 2 步建議新增 `cloudflareVideoUid` 欄位。為了不和同時進行的 schema 變更衝突，本次不加欄位，沿用既有的 `cloudflareStreamUid`／`cloudflarePlaybackId`／`cloudflareLiveInputUid`，webhook 與 `cloudflare-ops.ts` 寫入的 `videodelivery.net/<uid>` 網址不變。
- **`CLOUDFLARE_STREAM_CUSTOMER_CODE`**：程式上選填（未設定時沿用 DB 網址的主機），部署時建議一併設定（第 8 節第 2 步），簽章網址改用 `customer-<CODE>.cloudflarestream.com`。
- **鎖定新上傳另設旗標**：`CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS`，在 Staging 驗證簽章播放通過後才開，避免金鑰一設定新影片就要求簽章。
- **用量**：本次只做簽章，用量仍以 `/api/stream-usage` 心跳入帳，不改用 Cloudflare 遞送分鐘對帳（第 3 節第 6 步維持現狀）。
- **仍未簽章的位置**：`GET /api/media/videos/status` 回給編輯器的 `videoUrl`（編輯器不播放，只做狀態檢查）。
- **課程影片不支援 Stream 鎖定**：課程單元與漏斗頁影片元件的網址由商家自填（`url` 類型），依設計不簽章；商家若貼上平台 Stream 網址，影片鎖定後會無法播放。需要課程使用 Stream 影片時另案處理。

## 8. 部署步驟

每個環境（Preview／Staging → Production）各做一次，順序不可顛倒。

1. **建立 signing key（owner）**：在該環境的 Cloudflare 帳號呼叫 `POST /accounts/{account_id}/stream/keys`，記下回應的 `id` 與 `pem`（只顯示一次，存入密碼管理器）。各環境用不同的 key。
2. **設定環境變數**：在 Vercel 對應環境設定 `CLOUDFLARE_STREAM_SIGNING_KEY_ID`＝`id`、`CLOUDFLARE_STREAM_SIGNING_KEY_PEM`＝`pem`（可直接貼 Cloudflare 回傳的 base64 字串）、`CLOUDFLARE_STREAM_CUSTOMER_CODE`＝Stream 後台 `customer-<CODE>` 的 `<CODE>`；需要 Preview 網域時設定 `STREAM_ALLOWED_ORIGINS`（例如 `*.vercel.app` 或明確的 Preview 網域）。**先不要設** `CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS`。重新部署後確認 `/api/admin/preflight` 的 `CLOUDFLARE_STREAM_SIGNING_KEY_ID`、`STREAM_ALLOWED_ORIGINS` 為 PASS，`CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS` 為 WARN。
   - 此時播放器已拿到簽章網址，但所有影片（含新上傳）都還沒有 `requireSignedURLs`，新舊網址都能播放。
3. **Staging 驗證（簽章網址）**：用合成資料的直播與回放各看一次，確認：入場後的播放網址是 token 形式且能播放；Chrome 與 Safari 都能跨過第一次續期（直播約第 8 分鐘、回放約第 28 分鐘）不中斷；回放截止前的 token `exp` 等於截止時間；下列頁面的影片或縮圖可顯示：影片清單、影片編輯頁（縮圖預覽，儲存後 DB 的縮圖網址不含 token）、影片預覽、直播預覽、互動腳本清單與編輯頁、公開報名頁宣傳影片；`RUN_CLOUDFLARE_SMOKE` 的 Stream smoke 回報 `signedPlayback: true` 並通過（smoke 播放時帶 app 的 `Origin`）。
   - **token 失效恢復**：在瀏覽器開發者工具攔截 segment 或 manifest 請求回 403（或把網路斷開到 token 過期），恢復後斷言 `video.currentTime` 接近攔截前的位置（不歸 0），且播放中的影片會繼續播放、原本暫停的維持暫停；Chrome（hls.js）與 Safari（原生 HLS）各測一次。
   - **`allowedOrigins` 與沒有 `Origin` 的請求**：以 `curl` 直接取簽章網址（不帶 `Origin`），以及帶其他網域的 `Origin`，記錄 Cloudflare 的回應；確認 Safari 原生 HLS 的 segment 請求（可能不帶 `Origin`）在 app 網域下可以播放。若沒有 `Origin` 的請求也被擋，Safari 原生播放需要改設計。
   - **自動化（`.github/workflows/staging-stream-playback-browser.yml`，只能從受保護的 master 手動觸發）**：`scripts/staging-stream-playback-browser.mjs` 以 WP4 合成商家的短效 owner session 建立固定名稱的合成素材（55 分鐘合成影片只上傳一次、之後重複使用；報名表含宣傳影片、報名成功信、互動腳本），每次執行另建一場已進入回放的 VOD 直播（回放期限在建立後 58 分鐘，quick 為 20 分鐘）；再以無 cookie 的訪客從公開直播頁入場（不報名、不結帳、不寄信）。報名表在「全部專案總覽」建立（不歸屬專案才會立即公開，見 `src/lib/public-registration-form.ts`），建立後切回原本的專案範圍。Chrome（hls.js）job 檢查：app 自己產生的 Stream 網址（入口 manifest、縮圖、頁面直接放的資源）一律是 token 形式；播放器依 Cloudflare 播放清單載入的變體清單與 segment 若是 uid 形式，屬 Cloudflare 的選擇，receipt 依請求類型與遮蔽後的路徑樣式（`stream_playback_requests=`）逐一計數且必須載入成功，鎖定（第 4 步）後要再看一次；每個回放 token 的 `exp` 等於 `min(簽發 + 30 分鐘, 回放期限)`（至少一次等於回放期限）、`page.route` 讓 Stream 請求回 403 後恢復（只擋當時 token——連同播放器從該 token 的播放清單載入的 uid 形式請求，以最壞情況假設它們隨 token 失效——與全部擋兩種；播放中與暫停各一次），以及 `full` 情境播放跨過第一次續期（約第 28 分鐘），並在回放期限允許時播到第一個 token 過期後 3 分鐘都不中斷；Node 端以 app `Origin`、不帶 `Origin`、其他 `Origin` 與簽章損毀的 token 取 manifest，只記錄 HTTP 狀態碼；並檢查影片清單、影片編輯頁縮圖（存回的縮圖網址仍是 uid 形式）、影片預覽、互動腳本清單與編輯頁、公開報名頁宣傳影片能載入（直播預覽頁只有 evergreen 且開啟預覽時才有播放器，非 evergreen 直播記為不適用）。macOS 的 Playwright WebKit job 只是 WebKit 引擎的佐證，receipt 一律記 `safari: NOT_COVERED`：Playwright WebKit 不是 Safari，且 app 在支援 MediaSource 時一律用 hls.js；Safari／iPhone 原生 HLS 與直播（約第 8 分鐘）續期仍需人工實測（staging 工具沒有合成的直播推流來源）。
4. **鎖定新上傳**：第 3 步全部通過後，設定 `CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS=true` 並重新部署；上傳一支合成影片，確認 Cloudflare 後台顯示 `requireSignedURLs: true`、舊式網址被拒、簽章網址可播放。
5. **既有影片批次鎖定**：避開直播時段，對每個 vendor 先 dry-run 確認清單，再 `apply`：

   ```bash
   curl -sS -X POST "$APP_URL/api/admin/ops/cloudflare/require-signed-urls" \
     -H "Authorization: Bearer $JOB_SECRET" -H "Content-Type: application/json" \
     -d '{"vendorId":"<vendorId>","mode":"lock"}'
   # 確認 results 後加上 "apply": true；有 nextCursor 就帶 "cursor" 繼續，直到 nextCursor 為 null
   ```

   結果只含 `videoId`、`uid` 與狀態；`failed` 的項目可重跑（同一設定重送結果相同），`not_found` 表示 Cloudflare 上已無該資源。每次 `apply` 會寫一筆稽核；回應為 207（`audited: false`）時 Cloudflare 已變更但稽核沒寫入，要另外記錄這批結果。
6. **Staging 驗證（舊網址失效）**：抽樣確認舊的 `https://videodelivery.net/<uid>/manifest/video.m3u8` 被拒、經入場取得的網址可播放、其他網域嵌入被 `allowedOrigins` 擋下；確認直播進行中以 live input 播放也要求簽章（第 6 節待實測項目），live input 的 `meta`、錄影模式在 PUT 後未被改動。
7. **Production**：Staging 全部通過後，對 Production 重複第 1–6 步。
8. **回滾**：先用同一個端點的 `"mode":"unlock"` 對每個 vendor 解除（同樣先 dry-run、再 `apply`，不需要金鑰；會送 `requireSignedURLs: false` 並清空 `allowedOrigins`），並移除 `CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS`；確認影片都恢復公開後，才視需要移除簽章環境變數。順序反過來的話，已鎖定的影片在移除金鑰後會無法播放。
9. **金鑰輪替**：建立新 key → 更新環境變數並部署 → 等最長 token 效期過後（預覽與宣傳影片的 token 最長 4 小時）再 `DELETE /stream/keys/{舊 key id}`。

## 9. 影片就緒狀態：webhook 為主、主動查詢為備援（A4-04，2026-11-24）

**限制**：一個 Cloudflare 帳號只能設定**一個** Stream webhook 網址。帳號的通知網址指向 Production 時，staging 永遠收不到就緒通知（2026-11-24 實測：上傳後 16 分鐘內 `/api/cloudflare/*` 請求 0 筆，`staging-stream-resource-smoke.yml` 停在 `RESOURCE_DEADLINE_EXCEEDED`）。Production 只靠 webhook 也是單點：漏收一次，該影片就永遠不會就緒。

**做法**：webhook（`/api/cloudflare/stream-webhook`）仍是主要路徑；另外以唯讀的 `GET /accounts/{account}/stream/{uid}` 主動查詢作備援。

| 項目 | 內容 |
|---|---|
| 共用寫入 | `src/lib/cloudflare-stream-video-sync.ts` 的 `applyCloudflareStreamProviderState` 是唯一把 Cloudflare 狀態寫進 `Video` 的程式；webhook 與主動查詢都呼叫它（同一個 Zod schema、同一張狀態轉換表、同樣的 duration／縮圖／播放網址欄位）。主動查詢只在 Cloudflare 回 `readyToStream: true` 時呼叫；未就緒、錯誤、逾時、回應 uid 不符或 duration 超出範圍都不寫 |
| 租戶與現行資產 | 主動查詢從已知的影片出發，uid 查回的列必須正好是同一支影片與同一個 vendor（否則 `scope_mismatch`），而且這支影片的**現行資產**必須仍是這個直傳上傳：`sourceType = cloudflare_stream`，`cloudflareStreamUid` 與 `cloudflarePlaybackId` 都等於這個 uid（否則 `stale_asset`）。同一個 uid 對到多支影片時一律不寫。查前檢查、每次條件寫入（`updateMany`，含 `id`、`vendorId`、目前 `status`）與搶輸後的重讀都帶同一個資產條件，所以影片在查詢途中被改指向直播輸入或新上傳時不會被寫。webhook 仍以三個 uid 欄位任一相符找列，寫入與重讀同樣要求列仍對應這個 uid |
| 冪等 | webhook 與查詢同時送達時只有一方寫入；另一方讀到已就緒且內容相同就結束，不重寫 |
| 改指向時的 uid 欄位 | `createLiveInputMapping` 把既有影片改指向直播輸入時清掉 `cloudflareStreamUid`（2026-11-24 審查 MAJOR-1：保留舊 uid 會讓舊上傳的就緒結果把影片改回舊上傳並標成 ready）。`persistStreamVideo`（替換上傳）保留 `cloudflareLiveInputUid`，因為直播輸入的 key 與錄影設定仍掛在這個欄位；主動查詢靠現行資產條件排除這種列。部署前就已保留舊 uid 的直播輸入列不需要清資料：排程只掃 `cloudflare_stream`，寫入也要求現行資產相符 |
| 排程 | `/api/jobs/stream-ready-sync`（`JOB_SECRET`，每 5 分鐘）：上傳（`updatedAt`）後 5 分鐘到 24 小時、`sourceType = cloudflare_stream`、仍 `processing` 且未就緒、有 `cloudflareStreamUid` 的影片（最多讀 500 列）。6 小時內回過 404 的先排除；其餘依上次實際查詢時間由舊到新（從未查過的最先）、再商家輪流，所以新上傳不會讓較舊的上傳一直排不到。每輪最多 10 次 Cloudflare 查詢、30 秒後不再開始、單次 8 秒。每支影片依上傳時間退避：1 小時內每輪（4 分鐘窗）、6 小時內約 30 分鐘、之後約 2 小時，計數存在 `AccountRateLimitBucket`（跨 instance 共用，不新增 migration）；計數器讀寫失敗時不查詢 |
| 404 | Cloudflare 回 404（直傳沒有完成或上傳網址已過期）時記 `notFound`、不送 Sentry，並鎖 6 小時不再查（`stream_ready_poll_not_found`）；24 小時時間窗內最多再查約 4 次 |
| ops 狀態端點 | `GET /api/admin/ops/cloudflare/direct-upload?videoId=…`（`OPS_SMOKE_SECRET`，只看 smoke vendor 的影片）：影片未就緒、為 `processing` 且是 `cloudflare_stream` 時順便查一次，每支影片 15 秒最多一次、全部每分鐘最多 12 次、單次 5 秒。回應多一個 `providerCheck`（`updated`、`unchanged`、`not_ready`、`not_found`、`stale_asset`、`throttled`、`provider_error`、`provider_unavailable`、`throttle_unavailable`、`error` 等固定類別），寫入後重新讀取再回傳。staging smoke 每 5 秒讀一次，不必等排程 |
| 輸出 | 只有計數與固定類別；不輸出 token、簽章網址、provider 訊息或 uid。404 以外的查詢錯誤每輪彙總送一次 Sentry warning（`stream_ready_sync_job`／`provider_query`，`status` 例如 `network:2+provider_rejected:1`） |
| 外部呼叫上限 | 排程每 5 分鐘最多 10 次；每支影片 24 小時內最多約 34 次；ops 端點每分鐘最多 12 次。一般使用者或公開請求不會觸發查詢 |

`updatedAt` 當作上傳時間：替換上傳會重設它；未就緒期間若商家改了標題，時間窗會往後移，只是延後查詢，不會漏寫。

### 9.1 部署前就已卡住超過 24 小時的影片

排程只看 24 小時內的上傳，部署前就卡住的影片要手動補跑一次。**用 `JOB_SECRET` 呼叫補跑端點**（ops 狀態端點只看 smoke vendor 的影片，不能用來補一般商家）：

```bash
# 先只補一個商家確認結果，再視需要拿掉 vendorId 補全部
curl -sS -X POST "$APP_URL/api/admin/ops/cloudflare/stream-ready-sync" \
  -H "Authorization: Bearer $JOB_SECRET" -H "Content-Type: application/json" \
  -d '{"maxAgeHours":720,"vendorId":"<vendorId>"}'
```

- `maxAgeHours` 是 24–720 的整數（最長 30 天），其他欄位一律 400。
- 每次呼叫與排程同樣最多查 10 支、30 秒截止；卡住超過 6 小時的影片退避約 2 小時。重複呼叫直到 `candidates` 為 0，或只剩 `throttled`／`notReady`／`notFoundHeld`；`throttled` 多時隔 2 小時再跑。
- 回應只有計數。`updated` 是這次補成就緒的支數；`notFound` 是 Cloudflare 上已不存在的上傳（請商家重新上傳）；`providerErrors` 大於 0 時看 Sentry `stream_ready_sync_job`。
- Production 呼叫前照一般 Production 操作規則先取得 owner 同意；staging 可直接執行。

部署注意：Cloudflare Worker 觸發器（`ops/cloudflare/scheduled-jobs-worker`）要重新部署才會呼叫新的 job；GitHub heartbeat 與 `scheduled-jobs.yml` 合併後即生效。部署環境需有 `CLOUDFLARE_ACCOUNT_ID`／`CLOUDFLARE_STREAM_TOKEN`（Stream 讀取權限即可），沒有時回 `skipped: "provider_unavailable"`。
