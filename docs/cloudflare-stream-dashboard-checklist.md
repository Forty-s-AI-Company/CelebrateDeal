# Cloudflare Stream Dashboard Checklist

最後更新：2026-07-09

## 目的

收斂目前 `code=10000 Authentication error`，並建立 CelebrateDeal 正式上線前 Cloudflare Stream / Stream Live 驗收流程。

官方參考：

- Cloudflare Stream direct creator uploads：https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/
- Cloudflare Stream get started / Live Input API：https://developers.cloudflare.com/stream/get-started/
- Cloudflare Stream VOD webhooks：https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/
- Cloudflare Stream Live webhooks：https://developers.cloudflare.com/stream/stream-live/webhooks/

## 1. 目前 app 使用的 Cloudflare API

CelebrateDeal 目前 server-side 呼叫：

```txt
POST https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/stream/direct_upload
POST https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/stream/live_inputs
GET  https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/stream/<uid>
```

請確認：

- `CLOUDFLARE_ACCOUNT_ID` 是 Stream 所在 account，不是 zone id。
- `CLOUDFLARE_STREAM_TOKEN` 是 API Token，不是 Global API Key。
- token resource scope include 的 account 必須與 `CLOUDFLARE_ACCOUNT_ID` 相同。
- token 權限至少要能建立 Stream direct upload 與 Live Input；建議用 `Account -> Stream -> Edit`。
- 修改 Vercel env 後必須重新部署，否則 runtime 仍會拿舊 token。

## 2. `code=10000 Authentication error` 排查順序

1. 在 Cloudflare dashboard 右側 account selector 確認目前 account。
2. 複製 dashboard 顯示的 account id，對照 `CLOUDFLARE_ACCOUNT_ID`。
3. 到 My Profile -> API Tokens，確認 token 未撤銷、未過期。
4. 確認 token permissions 為 account-level Stream edit 權限。
5. 確認 token account resources include 正確 account。
6. 在本機或 staging shell 只用 placeholder-safe 方式測試，不把 token 印出。
7. 若 Vercel env 已更新，重新 deploy staging / production。

## 3. Dashboard 設定檢查

- [ ] Stream 已在 Cloudflare account 啟用。External required
- [ ] API Token 已建立，scope 指向正確 account。External required
- [ ] Token 權限包含 Stream edit。External required
- [ ] Vercel staging env 已設定 `CLOUDFLARE_ACCOUNT_ID`。External required
- [ ] Vercel staging env 已設定 `CLOUDFLARE_STREAM_TOKEN`。External required
- [ ] Vercel staging env 已設定 `CLOUDFLARE_STREAM_WEBHOOK_SECRET`。External required
- [ ] Vercel production env 同步設定。External required

## 4. App Diagnostics

後台路徑：

```txt
/admin/cloudflare/videos
```

此頁會顯示：

- Account ID 是否存在與長度
- Stream token 是否存在與字元長度
- webhook secret 是否存在與字元長度
- app 呼叫的 API base / endpoint
- `code=10000 Authentication error` 常見原因

注意：頁面不顯示 token 原文，也不顯示 stream key 明文。

## 5. 驗收命令

```bash
TARGET_APP_URL=https://<staging-domain> \
RUN_CLOUDFLARE_SMOKE=true \
SMOKE_VENDOR_ID=<vendorId> \
npm run external:smoke
```

預期：

- `cloudflare direct upload`：PASS
- `cloudflare upload file`：PASS
- `cloudflare stream ready`：PASS
- `cloudflare ready webhook replay`：PASS
- `cloudflare live input`：PASS
- live input response 只顯示 `streamKeyRef`，不可顯示明文 `streamKey`

## 6. Webhook 簽章設定

目前 app 的 `/api/cloudflare/stream-webhook` 支援兩種模式：

- `official-signature`：Cloudflare Stream VOD 官方 `Webhook-Signature`。
- `shared-secret-fallback`：`x-cloudflare-stream-webhook-secret`，保留給 staging / local smoke。

Cloudflare Stream VOD 官方 webhook 會使用 `Webhook-Signature` header 簽章。簽章格式類似：

```txt
Webhook-Signature: time=<unix-time>,sig1=<hex-hmac-sha256>
```

App 驗證方式：

1. 讀取未變更的 raw body。
2. 組成 `<time>.<rawBody>`。
3. 使用 `CLOUDFLARE_STREAM_WEBHOOK_SECRET` 做 HMAC-SHA256。
4. 將 hex digest 與 `sig1` 做 constant-time compare。
5. `time` 超過 5 分鐘會被視為 replay / expired timestamp。

Webhook signing secret 取得方式：

1. 在 Cloudflare Stream 建立或讀取 VOD webhook subscription。External required
2. Cloudflare API response 會回傳 webhook signing secret。External required
3. 將該 signing secret 設到 Vercel env：`CLOUDFLARE_STREAM_WEBHOOK_SECRET`。
4. 重新部署 staging / production。
5. 到 `/admin/cloudflare/videos` 確認 webhook mode 顯示 `official-signature` configured。

Cloudflare Stream Live notifications 走 Cloudflare Notifications webhook 設定，與 VOD upload ready webhook 不同。Live Input connected / disconnected 需在 Cloudflare Notifications 建立 destination 與 notification rule。

## 7. 本機 / Staging Fallback 驗收

若還沒拿到 Cloudflare 官方 signing secret，可先使用 shared secret fallback：

```bash
curl -X POST https://<app-domain>/api/cloudflare/stream-webhook \
  -H "Content-Type: application/json" \
  -H "x-cloudflare-stream-webhook-secret: <CLOUDFLARE_STREAM_WEBHOOK_SECRET>" \
  -d '{"uid":"<stream-uid>","readyToStream":true}'
```

注意：production 正式接 Cloudflare VOD webhook 時，應以 `Webhook-Signature` 為主。

## 8. 官方簽章 Fixture Replay

Repo 內已提供 Cloudflare VOD webhook fixture replay：

```bash
TARGET_APP_URL=https://<staging-domain> \
CLOUDFLARE_STREAM_WEBHOOK_SECRET=<cloudflare-webhook-signing-secret> \
npm run cloudflare:fixtures
```

fixtures：

- `ready`：預期 HTTP 200。
- `processing`：預期 HTTP 200。
- `error`：預期 HTTP 200。
- `invalid_signature`：預期 HTTP 401。
- `expired_timestamp`：預期 HTTP 401。

也可單獨重播：

```bash
npm run cloudflare:fixtures -- ready
npm run cloudflare:fixtures -- invalid_signature
```

注意：

- fixture 使用官方 `Webhook-Signature`，不是 shared secret fallback。
- fixture UID 預設不一定對應 DB 內影片，因此 `updated=0` 不代表驗簽失敗；真正 ready webhook 驗收仍需 direct upload 成功後由 Cloudflare 真實回呼。
- 若要驗證 DB 寫回，請先用 direct upload 建立 mapping，再等待 Cloudflare ready webhook 或用該 UID 重播 fixture。
