# CelebrateDeal External Service Validation Runbook

最後更新：2026-07-09

## 1. Supabase

操作清單：

1. 建立 staging project 與 production project。
2. 取得各自的 pooled/runtime `DATABASE_URL`。
3. 取得各自的 direct `DIRECT_URL`。
4. 在 Vercel preview / production 分別填入對應 URL。
5. 對 staging 先執行 migration。
6. staging 通過後，production migration 前先建立 snapshot。

驗收標準：

```bash
npm run db:migrate:deploy
npm run db:migrate:status
```

- `migrate deploy` 成功。
- `migrate status` 顯示 database schema is up to date。
- `/api/health` 回傳 `ok: true`。

風險：

- Preview / staging 不可連 production DB。
- `DIRECT_URL` 不可曝光到 client。
- 若使用 Supabase Data API，需確認 public schema tables 是否要 explicit grants / RLS。

## 2. Vercel

操作清單：

1. 建立 CelebrateDeal Vercel project。
2. 連接 GitHub repo。
3. 設定 Production branch。
4. 在 Environment Variables 填入 staging / production values。
5. 綁定正式 custom domain。
6. 部署 preview，驗證後再 promote 或部署 production。

驗收標準：

```bash
vercel env ls production
vercel env pull .env.production.local --environment=production --yes
npm run preflight
npm run external:smoke
```

- `/api/health` 正常。
- `/api/admin/preflight` 正常。
- Next.js production build 成功。

風險：

- 不要把 production secrets 設到 preview branch。
- `NEXT_PUBLIC_*` 不可放 secret。

## 3. Cloudflare Stream

操作清單：

1. 建立 Cloudflare API token，限制 Stream 權限。
2. 填入 `CLOUDFLARE_ACCOUNT_ID`。
3. 填入 `CLOUDFLARE_STREAM_TOKEN`。
4. 設定 Stream webhook URL：

```txt
https://app.celebratedeal.com/api/cloudflare/stream-webhook
```

5. 設定 `CLOUDFLARE_STREAM_WEBHOOK_SECRET`。
6. 跑 direct upload smoke test。
7. 跑 Live Input smoke test。
8. 準備一個 staging vendor，取得 `SMOKE_VENDOR_ID`，讓 smoke test 可把 Cloudflare UID 寫回 `videos`。
9. 準備同一商家的 active platform-checkout product，將 ID 設為 `SMOKE_PRODUCT_ID`；PayUni smoke 會先建立 pending transaction，再重播事件。

驗收標準：

```bash
RUN_CLOUDFLARE_SMOKE=true SMOKE_VENDOR_ID=vendor_xxx SMOKE_PRODUCT_ID=product_xxx npm run external:smoke
```

- direct upload 回傳 `uid` 與 `uploadURL`。
- direct upload 會寫回 `Video.cloudflareStreamUid`、`cloudflarePlaybackId`、`status=processing`。
- Live Input 回傳 `uid` 與 ingest URL，但不回傳明文 stream key。
- Live Input 會寫回 `Video.cloudflareLiveInputUid`，stream key 僅保存在後台資料欄位。
- webhook 收到 ready event 後，`Video.cloudflareReadyToStream` 更新為 true。

風險：

- direct upload 會保留可用 storage duration，測試後要清理不需要的 asset。
- stream key 不可顯示在一般前台或被 log。

## 4. PayUni

操作清單：

1. 取得 sandbox merchant id / HashKey / HashIV。
2. 填入 staging env vars。
3. 設定 `PAYUNI_ENV=sandbox`。
4. 確認 PayUni checkout adapter 使用整合式支付頁 `upp`。
5. 設定 sandbox webhook URL：

```txt
https://staging-app.celebratedeal.com/api/webhooks/payments?provider=payuni
```

6. 測試 checkout form post / redirect。
7. 測試 paid webhook。
8. 測試 partially refunded / refunded webhook。
9. 檢查 admin webhook detail reconciliation。
10. production 核准後，換 production credentials、`PAYUNI_ENV=production` 與 production webhook URL。

驗收標準：

- paid webhook 建立 `PaymentTransaction`。
- duplicate webhook 不重複入帳。
- refunded webhook 建立 `RefundRecord`。
- affiliate referralCode 可建立 `AffiliateCommission`。
- `/admin/billing/webhooks/:id` reconciliation 顯示 pass。
- PayUni `EncryptInfo` / `HashInfo` 能由 sandbox 回呼成功驗證。

風險：

- PayUni dashboard 欄位、正式商店審核、sandbox payload 差異需以 PayUni 後台實測校準。External required。
- production credentials 不可出現在 repo 或 logs。

## 5. Resend

操作清單：

1. 新增寄件 domain。
2. 設定 SPF / DKIM / DMARC。
3. 填入 `RESEND_API_KEY`。
4. 填入 `EMAIL_FROM`。
5. 執行測試信。

驗收標準：

```bash
SMOKE_TEST_EMAIL=you@example.com npm run external:smoke
```

- 收件匣收到 smoke test email。
- Resend dashboard 顯示 delivered。

風險：

- domain 未驗證會影響送達率。
- staging sender 建議與 production sender 分開。

## 6. Sentry

操作清單：

1. 建立 staging / production Sentry project。
2. 填入 `SENTRY_DSN`。
3. 填入 `NEXT_PUBLIC_SENTRY_DSN`。
4. 若要 source maps，填入 `SENTRY_ORG`、`SENTRY_PROJECT`、`SENTRY_AUTH_TOKEN`。
5. 執行 synthetic monitoring smoke test。

驗收標準：

```bash
npm run external:smoke
```

- `/api/admin/ops/test-monitoring` 回傳 ok。
- Sentry Issues 看到 `CelebrateDeal synthetic monitoring smoke test`。
- production alert rule 可收到通知。

風險：

- `SENTRY_AUTH_TOKEN` 是 secret，不可提交。
- source map upload token 權限應最小化。

## 7. PostHog

操作清單：

1. 建立 staging / production PostHog project。
2. 填入 `NEXT_PUBLIC_POSTHOG_KEY`。
3. 填入 `NEXT_PUBLIC_POSTHOG_HOST`。
4. 執行 product analytics smoke test。

驗收標準：

```bash
npm run external:smoke
```

- PostHog events 可看到 `production_smoke_test`。
- live page events：`page_view`、`cta_click`、`product_click`、`lead_submit` 可進 funnel。

風險：

- 不要把付款敏感資料送到 product analytics。
- visitor/session attribution 需與 affiliate ref 保持一致。

## 8. PayUni Fixtures 與 Durable Rate Limit 補充

PayUni 延伸 runbook：

- `docs/payuni-sandbox-checkout-runbook.md`

Repo 內可先驗證：

```bash
npm run test -- src/lib/payment-providers/payuni.test.ts
```

此測試會驗證 checkout form fields、paid fixture、refunded fixture 與 duplicate fixture normalize。

Upstash Redis 路線：

1. 建立 Upstash Redis database。External required
2. 複製 REST URL 與 Standard token。External required
3. 設定：

```txt
RATE_LIMIT_PROVIDER=upstash_redis
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

4. 執行：

```bash
npm run preflight
npm run test -- src/lib/rate-limit.test.ts
```

Cloudflare WAF 路線：

1. 在 Cloudflare zone 建立 WAF / rate limiting rules。External required
2. 設定：

```txt
RATE_LIMIT_PROVIDER=cloudflare_waf
```

3. `/api/admin/preflight` 應顯示 provider 為 `cloudflare_waf`。

注意：

- `memory` 只適合本機與單節點 smoke test。
- production 不建議只靠 app server in-memory rate limit。
