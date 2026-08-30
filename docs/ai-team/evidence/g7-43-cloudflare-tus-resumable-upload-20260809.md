# G7-43 Cloudflare Stream 大影片續傳證據

## 結果

`COMPLETE_LOCAL_DETERMINISTIC_EXTERNAL_PROVIDER_PENDING`

本工作包補上原本在 200 MB 直接中斷的影片流程。商家現在可選擇或拖拉最高 30 GB 的影片；200 MB 以下維持 basic direct upload，超過 200 MB 自動改走 Cloudflare Stream tus，提供進度、暫停、同頁續傳、重試與錯誤回饋。URL 仍只保留既有資料的進階用途。

## 實際產品修正

- 加入官方 `tus-js-client@4.3.1`，使用 50 MiB chunk、有限 retry delays、進度 callback、暫停與成功後 fingerprint cleanup。
- 新增 merchant-only resumable session Route Handler。Same-origin、trusted client header、active owner/admin membership 與 CSRF 由 `requireMerchantApiActor` 驗證，vendor 一律從 session 推導。
- Cloudflare Token 只用於 server-to-server `POST /stream?direct_user=true`；client 不接受 provider UID、stream key 或任意 provider host。
- upload URL 在 server 與 client 兩層只允許 `https://upload.videodelivery.net`。
- `Tus-Resumable`、`Upload-Length`、base64 `Upload-Metadata` 由 server 組合；最大檔案 30 GB、chunk 50 MiB。
- 改為兩階段 session／complete：provision 不建立或覆寫 `Video`。Server 以 AES-256-GCM 簽發綁定 vendor、video、provider uid、expiry 的 opaque ticket；tus 完成後由 complete API 解密驗證，查詢 Cloudflare 狀態後才寫入本地 mapping。
- `pendingupload`、provider `error`、未知 state、過期／跨 tenant／篡改 ticket 全部 fail closed。替換既有影片時，舊播放來源會保留到新影片成功收到 bytes。
- 新影片 ID 在 session 階段由 server 產生，complete replay 具冪等行為，不會重複建立影片。
- UI 將可續傳操作明確命名為「暫停上傳」；暫停保留 offset，provider 明確拒絕、ticket 失效或 asset processing error 才丟棄舊 session。

## 官方協定依據

- Cloudflare 要求超過 200 MB 使用 tus，chunk 最小 5 MiB、建議 50 MiB、最大 200 MiB，且須為 256 KiB 倍數：<https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/>
- Direct Creator tus 由 backend 傳送 `Tus-Resumable`、`Upload-Length`、`Upload-Metadata`，再把一次性 `Location` 交給 browser：<https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/>
- `tus-js-client` 支援 `uploadUrl` resume、retry、abort、progress 與 fingerprint storage：<https://github.com/tus/tus-js-client/blob/main/docs/api.md>

## 驗證結果

執行時段：2026-08-09 12:36～13:02 UTC。

| 驗證 | 結果 |
| --- | --- |
| `npm install tus-js-client --save` | exit 0；新增 19 packages；audit 0 vulnerabilities |
| 8 個核心 test files | exit 0；50/50 PASS |
| `video-form`、`live-stepper-form`、`product-form` consumer tests | exit 0；3 files、19/19 PASS |
| scoped ESLint | exit 0；無 finding |
| `npm run typecheck` | exit 0 |
| targeted `git diff --check` | exit 0；只有既有 LF/CRLF warning，無 whitespace error |
| `npm run build` | exit 1；在 Next build 前被既有 preflight 的 `CRON_SECRET` 缺少擋下；未執行 Next build，不標示 PASS，未讀取或修改 Secret，未重跑相同命令 |
| 第一、第二個 reviewer 路徑 | TOOL_TIMEOUT／shutdown；未冒充 PASS |
| focused analyst 首輪 | 找到 2 個 P2：DB 過早 mapping、暫停語意不清；修正後複核 resolved |
| focused analyst 第二輪 | 找到 1 個 P1：provider `error` 仍可能寫入；修正後最終複核 `no findings` |
| Cloudflare Sandbox／staging 真實大檔 | PENDING；本輪未操作正式服務，也未把 deterministic mock 當 provider PASS |

核心測試命令：

```text
npx vitest run src/lib/media-upload-client.test.ts src/lib/media-resumable-upload-client.test.ts src/components/media-upload-field.test.tsx src/lib/cloudflare-stream.test.ts src/lib/cloudflare-ops.test.ts src/app/api/media/videos/direct-upload/route.test.ts src/app/api/media/videos/resumable-upload/route.test.ts src/app/api/media/videos/resumable-upload/complete/route.test.ts
```

## Source attribution

| 檔案 | SHA-256 |
| --- | --- |
| `package.json` | `e56b1138f4d269c838c56888bf824ed3b82d252a3c3fd8f127973b45035f69b9` |
| `package-lock.json` | `80ca8219dee5fbe3b3d47413ed9fdcc8c82c130a48a736d632d247c3c708d2e3` |
| `src/lib/media-upload-client.ts` | `f9d5de725bd267d25b824ca05ee187a94342a89164e8e75ec002861972d0770a` |
| `src/components/media-upload-field.tsx` | `3f2c10991ca5f236852b81a137e35fd4bc846f396d9ff44a916a430b6a20d729` |
| `src/lib/cloudflare-stream.ts` | `8639d4675212e09ad05cfa7b9209223fafe0c36871339cbc40d90c23d406b896` |
| `src/lib/cloudflare-ops.ts` | `2ece2b3748666ec1da508bcc1706f0d9237e5d8b72377e590dcc0fe91471b53b` |
| resumable session route | `f8260a2fb46e9fe3340baa470d99113787513f5eb6898d2f6a2e5af9323fd6cf` |
| resumable complete route | `02893e96369042a3e71830f31208afee7717b2e7b579c94de2e50e9648fe966b` |

## Ownership 與安全

- `cloudflare-stream*`、`cloudflare-ops*` 在 G7-43 開始前為 clean；本工作包為唯一 writer。
- media UI、client、limits、direct-upload route 為 G7-03 既有 untracked 工作，本輪在同一 Goal ownership 下延續，沒有覆蓋未知 writer。
- `package.json`／lock 原本已有 R2 與 dependency override 變更；本輪只追加 `tus-js-client` 與其 lock graph，保留既有內容。
- 無 schema／migration、無 production DB／付款／寄信／deploy、無 `.env*`／Token／Cookie／正式資料讀取或輸出。

## 分數與 blocker

- 固定功能 `image_video_media` 可由 `8.0 → 8.6`：core `2.5 → 2.7`、recovery `1.6 → 1.9`、UX `1.5 → 1.6`；integrity/security 維持 1.0，fresh evidence 維持 1.4，因真實 Cloudflare staging 大檔驗收仍未執行。
- canonical 維持 `74.0`。這個本機產品能力不能代替 CAT04 PayUni Sandbox，也不能代替 CAT10 真人與外部驗收。
- CAT04／CAT10 保持 blocker，但不阻擋下一個自主功能工作。

## 回滾

回滾範圍限於新增 `tus-js-client` dependency、resumable session／complete routes、Cloudflare tus helper／two-phase mapping、media client／UI 與對應 tests。無資料 migration；既有 basic upload、R2 圖片、直播與其他 dirty worktree 變更均不在回滾範圍。

## 下一個最高產品價值工作

G7-44：以實際商家操作重新檢查 Live Studio 五步 wizard 的中斷續作、預覽、空狀態與發布前錯誤恢復，優先修正可重現流程摩擦；Bombmy／Chrome 僅做唯讀互動模式比對，不修改競品資料。
