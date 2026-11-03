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
