# Production Rate Limit Runbook

最後更新：2026-07-18

## 目的

將 CelebrateDeal production 的防刷從本機 `memory` provider 收斂到 durable provider，確保多節點 / serverless 部署下 login、checkout、form submission、analytics、affiliate clicks 都有一致控流。

官方參考：

- Upstash Redis REST API：https://upstash.com/docs/redis/features/restapi
- Upstash Rate Limit overview：https://upstash.com/docs/redis/sdks/ratelimit-ts/overview

## 1. 目前 provider

`src/lib/rate-limit.ts` 支援：

- `memory`：本機與 smoke 用，不適合 production 多節點。
- `upstash_redis`：app-level durable limiter。
- `cloudflare_waf`：edge-level limiter，請在 Cloudflare dashboard 設 rule。

受保護路由：

- `/login`（每來源總量 20 次／15 分鐘；每來源＋正規化 Email 5 次／15 分鐘）
- `/api/payments/checkout`
- `/api/form-submissions`
- `/api/analytics`
- `/api/affiliate-clicks`
- `/api/security/csp-report`
- `/api/auth/password-reset/request`
- `/api/auth/password-reset/confirm`
- `/mfa/verify`（管理員 MFA 驗證入口）

## 2. Upstash Redis 啟用

1. 建立 Upstash Redis database。External required
2. 複製 REST URL 與 REST token。External required
3. 在 Vercel staging 設定：

```txt
RATE_LIMIT_PROVIDER=upstash_redis
UPSTASH_REDIS_REST_URL=<upstash-rest-url>
UPSTASH_REDIS_REST_TOKEN=<upstash-rest-token>
```

4. 重新部署 staging。
5. 執行：

```bash
npm run preflight
```

預期：

- `RATE_LIMIT_PROVIDER` 不再是 memory warning。
- `UPSTASH_REDIS_REST_URL` pass。
- `UPSTASH_REDIS_REST_TOKEN` pass。

## 3. Smoke 驗收

Staging：

```bash
TARGET_APP_URL=https://<staging-domain> npm run external:smoke
```

手動壓測單一路由：

```bash
for i in {1..20}; do
  curl -i https://<staging-domain>/api/analytics \
    -H "Content-Type: application/json" \
    -H "X-CelebrateDeal-Client: web" \
    -d '{"eventName":"rate_limit_smoke","liveId":"invalid"}'
done
```

預期：

- 前幾次可能回 400 / 404 類資料驗證錯誤。
- 超過該 route limit 後應回 `429 Too Many Requests` 或 provider fail closed `503`。
- response 應帶 `Retry-After`。

## 4. Cloudflare WAF 路線

若使用 `RATE_LIMIT_PROVIDER=cloudflare_waf`：

1. 在 Cloudflare zone 建立 WAF / rate limiting rules。External required
2. rule 至少覆蓋：
   - `/api/payments/checkout`
   - `/api/form-submissions`
   - `/api/analytics`
   - `/api/affiliate-clicks`
   - `/api/auth/password-reset/*`
   - `/mfa/verify`
   - `/login`
3. 設定 production env：

```txt
RATE_LIMIT_PROVIDER=cloudflare_waf
```

4. `/api/admin/preflight` 應顯示 provider 為 `cloudflare_waf`。

注意：此模式由 Cloudflare edge 擋流，app 內 `checkRateLimit()` 會直接放行，因此必須在 dashboard 完成 rule 驗收。

`/login` 的 rule 必須以可信 proxy 注入的 `cf-connecting-ip`（優先）或 `x-forwarded-for` 首個位址作為來源識別，並同時涵蓋來源總量與來源＋正規化 Email；不可只依 Email 計數。登入限流回應為 429 時顯示「登入失敗次數過多」提示；限流服務不可用時，app 必須 fail closed 並顯示登入保護服務暫時無法使用的提示。

## 5. Staging / Production Env Checklist

Staging：

- [ ] `RATE_LIMIT_PROVIDER=upstash_redis` 或 `cloudflare_waf`
- [ ] 若使用 Upstash，`UPSTASH_REDIS_REST_URL` 已設定。External required
- [ ] 若使用 Upstash，`UPSTASH_REDIS_REST_TOKEN` 已設定。External required
- [ ] `/api/admin/preflight` rateLimit 顯示 durable provider
- [ ] `/login` 已確認來源總量與來源＋正規化 Email 兩層均會回 429，且 provider 不可用時回到登入保護服務提示
- [ ] checkout / form / analytics / affiliate-clicks smoke 已確認 429

Production：

- [ ] 與 staging 使用同 provider
- [ ] 不使用 staging Redis token
- [ ] Cloudflare WAF rule 或 Upstash dashboard alert 已啟用。External required
- [ ] 觀察 24 小時誤擋狀況

## 6. 風險

- `memory` 在 Vercel / serverless 多 instance 下無法一致控流。
- `cloudflare_waf` 模式需要 dashboard rule 真實存在，否則 app 內不會再阻擋。
- Upstash token 是 secret，不可寫入 repo 或 client bundle。
- Rate limit 是防濫用層，不取代 CSRF、auth、payment amount server-side validation。
