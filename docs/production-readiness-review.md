# CelebrateDeal Production Readiness Review

最後更新：2026-07-09

## 1. 本輪審查摘要

本輪針對可收費 MVP 上線前的安全性、營運穩定性與外部服務接線做 repo 內可驗證改善。

已完成：

- Server Actions 已加上無狀態 HMAC CSRF token 與 Origin / Referer 檢查。
- Public JSON POST API 已加上 same-origin 檢查與 `X-CelebrateDeal-Client: web` header gate。
- Rate limit 已抽成 `memory / cloudflare_waf / upstash_redis` provider 介面，production durable provider 標記為 External required。
- Playwright smoke E2E 已加入 `/login`、未登入導向、admin protect、live page、form submit、checkout product price、Bearer 401。
- PayUni checkout adapter 已可建立 server-side UPP form post payload，不信任 client amount。
- Cloudflare direct upload / Live Input 建立後會寫回 `videos` mapping，Stream webhook ready event 會更新 ready 狀態。
- 管理與 job 類 API 改為缺少 secret 時 fail closed。
- Cloudflare Stream direct upload / Live Input 建立 API 加上 Bearer `JOB_SECRET` 保護。
- Cloudflare Stream webhook 改為必須驗證 `CLOUDFLARE_STREAM_WEBHOOK_SECRET`。
- `CLOUDFLARE_STREAM_WEBHOOK_SECRET` 升級為 preflight 必要欄位。
- Checkout API 不再信任前端傳入金額，改由後端 Product 決定價格與幣別，並建立 provider checkout session。
- Public API 加上輕量 rate limit 與 vendor / live 關聯檢查。
- Webhook 簽章失敗 audit log 不再保存 raw body。
- Health check 不再回傳原始 DB error。
- ecpay-like adapter 移除 demo fallback secret。
- 新增 baseline security headers。
- `.gitignore` 保護 `cookies.txt` / `*.cookies.txt`，並允許 `.env.staging.example` 進版控。
- CI 補上 build、preflight 與 Playwright smoke。

## 2. 高風險問題與處置

### P0-1 Protected endpoints fail open

影響：

- `/api/admin/preflight`
- `/api/admin/ops/test-email`
- `/api/admin/ops/test-analytics`
- `/api/admin/ops/test-monitoring`
- `/api/jobs/webhook-retry`

原問題：

- 當 `JOB_SECRET` 未設定時，部分 endpoint 會直接放行。

修正：

- 新增 `src/lib/api-security.ts`。
- 全部改為 `requireJobSecret(request)`，沒有 secret 或 token 不符皆回 401。

### P0-2 Cloudflare resource creation was public

影響：

- `/api/cloudflare/direct-upload`
- `/api/cloudflare/live-inputs`

原問題：

- 任意訪客可呼叫建立 Cloudflare Stream direct upload / live input，造成成本與濫用風險。

修正：

- 兩個 endpoint 皆加上 Bearer `JOB_SECRET`。

### P0-3 Checkout amount trusted client input

影響：

- `/api/payments/checkout`

原問題：

- API 接受前端傳入 `amountCents` 與 `currency`，可能被竄改金額。

修正：

- 改為必須提供 `productId`。
- 後端查詢 active product，使用 `Product.priceCents` / `Product.currency`。
- 售罄商品回 409。

### P1-1 Public API spam and relation mismatch

影響：

- `/api/form-submissions`
- `/api/analytics`
- `/api/affiliate-clicks`
- `/api/payments/checkout`

修正：

- 新增 `src/lib/rate-limit.ts` 做 repo 內輕量限流。
- 新增 provider abstraction：`memory`、`cloudflare_waf`、`upstash_redis`。
- External required：正式 production 必須使用 Cloudflare WAF 或 Upstash Redis 等 durable limit；in-memory 只適合單節點 dev / smoke。
- 表單、前台事件、聯盟點擊補 vendor / live 關聯檢查。

### P1-3 CSRF / Cross-site submit hardening

修正：

- 新增 `src/lib/csrf.ts` 與 `src/components/csrf-field.tsx`。
- 所有 mutating Server Actions 先驗證 CSRF token 與 request origin。
- `logout`、session revoke、billing settlement / payout、refund、webhook retry、settings、interaction roles / scripts 等敏感操作皆已納入。
- `/api/form-submissions`、`/api/analytics`、`/api/affiliate-clicks`、`/api/payments/checkout` 使用 same-origin + client header gate。

### P1-4 PayUni checkout and Cloudflare Stream mapping

修正：

- PayUni adapter 新增 server-side checkout session builder。
- PayUni `upp` checkout payload 使用 AES-256-GCM `EncryptInfo` 與 `HashInfo`，並回傳 form post payload 給前台送出。
- Payment webhook route 可用 query `provider=payuni` 選擇 adapter，支援 PayUni 回呼沒有自訂 header 的情境。
- Cloudflare direct upload 建立後寫回 `Video.cloudflareStreamUid`、`cloudflarePlaybackId`、`videoUrl`、`status=processing`。
- Cloudflare Live Input 建立後寫回 `Video.cloudflareLiveInputUid` 與 stream key reference，API response 不回傳明文 stream key。

### P1-2 Sensitive diagnostics in responses / audit logs

修正：

- `/api/health` 不再輸出 DB raw error。
- payment webhook invalid / signature failed audit log 改記錄 body bytes，不保存 raw body。

## 3. 安全性、效能、可讀性、可維護性審查

安全性：

- 已處理 fail-open secret 檢查、client amount tampering、raw error leakage、raw webhook audit body、CSRF / cross-site submit。
- 尚待正式上線前補 MFA、password reset token、正式 CSP nonce / report-only rollout。

效能：

- 新增 rate limit 為 in-memory best effort，避免低成本 spam。
- 上 production 後仍應以 Cloudflare WAF / Turnstile / Bot rules 或 Upstash Redis 作為主要 durable 防線。External required。

可讀性：

- Secret 驗證集中於 `src/lib/api-security.ts`。
- Public rate limit 集中於 `src/lib/rate-limit.ts`。
- Checkout flow 的價格來源更清楚，由 Product 作為單一事實來源。

可維護性：

- CI 現在會跑 build / preflight / Playwright smoke，可提早抓部署前缺 env、build cache 或核心流程壞掉的問題。
- External required 項目維持在 runbook / checklist，不把真實 secret 寫入 repo。

## 4. 仍需外部驗收

以下需要登入 dashboard 或真實 sandbox credentials：

- Supabase staging / production migration 與 restore drill。
- Vercel env vars / custom domain / deployment promotion。
- Cloudflare Stream direct upload、Live Input、ready webhook。External required。
- PayUni sandbox / production checkout、paid / refunded / duplicate webhook / reconciliation。External required。
- Resend domain verification 與 test email delivered。
- Sentry synthetic issue 與 alert rule。
- PostHog production event 與 funnel dashboard。

## 5. 本輪驗證結果

本輪已用本機 Docker PostgreSQL 驗證，不使用任何 production secret。

```bash
npm run db:generate
npm run db:migrate:deploy
npm run db:migrate:status
npm run lint
npm run typecheck
npm run test
npm run build
npm run preflight
npm run e2e:smoke
```

結果：

- `db:generate`：通過。
- `db:migrate:deploy`：本機 Docker PostgreSQL 無 pending migrations。
- `db:migrate:status`：Database schema is up to date。
- `lint`：通過。
- `typecheck`：通過。
- `test`：3 個 test files / 9 tests passed。
- `build`：Next.js 16 production build 通過，50 個 app routes 完成編譯。
- `preflight`：通過；`NEXT_PUBLIC_SENTRY_DSN` 與 `RATE_LIMIT_PROVIDER` 仍為 production 建議 warning。
- `e2e:smoke`：6 tests passed。

注意：

- Vitest 已排除 `tests/e2e/**`，避免 Playwright spec 被 unit runner 誤載。
- Vitest / Playwright config 已加入本機 PostgreSQL fallback，避免舊 SQLite env 讓測試誤失敗。
- Public form 已改為 progressive enhancement，避免 hydration 前點擊造成原生 GET submit。

## 6. 建議下一輪 P0

- 將 public API rate limit 升級為 Cloudflare WAF / Turnstile / durable KV 或 Upstash Redis。External required。
- 使用 PayUni sandbox dashboard 實測 checkout、paid、refunded、duplicate webhook。External required。
- 使用 Cloudflare dashboard 實測 direct upload、Live Input、ready webhook。External required。
- 補 production CSP nonce / report-only rollout。

## 7. Sandbox 驗收與 Hardening 更新

新增完成：

- Upstash Redis durable rate limit provider 已完成 repo 內實作；`memory` 仍保留給本機，`cloudflare_waf` 保留為邊界層策略。
- Public checkout / form submission / analytics / affiliate click routes 已改用 async durable limiter。
- PayUni webhook detail 新增 `EncryptInfo` / `HashInfo` 診斷卡，顯示欄位存在、長度與 hash verification，不顯示 HashKey / HashIV。
- Webhook raw payload、audit snapshot、新增 diagnostics 顯示皆套用 redaction policy。
- PayUni sandbox fixtures 已加入 paid / refunded / duplicate webhook test data。
- Cloudflare direct upload / Live Input mapping 抽成 `src/lib/cloudflare-ops.ts`，新增 admin ops helper endpoint。
- 新增 `/admin/cloudflare/videos` ready / playback URL 檢查頁。
- 新增 CSP report-only header 與 `/api/security/csp-report`。
- 新增 password reset token flow，token hash 入庫，confirm 後 revoke sessions。
- 新增 MFA hardening plan：`docs/admin-mfa-hardening-plan.md`。

仍需 External required：

- PayUni sandbox dashboard 實測 checkout form post 與 webhook。
- Cloudflare dashboard 實測 direct upload、Live Input 與 ready webhook。
- Upstash Redis REST credential 或 Cloudflare WAF rule production 啟用。
- Resend password reset email template 與 domain verification。
- Admin TOTP MFA 實作與營運復原流程。

## 8. Password Reset / MFA / Sandbox 閉環更新

本輪新增完成：

- Password reset 已從 token schema 升級為完整 UI + API flow：
  - `/password-reset/request`
  - `/password-reset/confirm`
  - `/api/auth/password-reset/request`
  - `/api/auth/password-reset/confirm`
- password reset token 僅存 `sha256` hash，30 分鐘 TTL，confirm 後會：
  - 更新密碼
  - 將 token 標記 `usedAt`
  - revoke 所有 active sessions
  - 寫入 `audit_logs`
- Admin MFA 最小實作已完成：
  - TOTP enrollment / verify
  - recovery code hash 入庫
  - `UserSession.mfaVerifiedAt`
  - `/admin/**` 對 platform admin 與 finance roles 強制 MFA gate
  - enrollment / verify / recovery code usage 寫入 `audit_logs`
- Cloudflare admin ops helper route 現在失敗時會回傳 JSON diagnostics，不再是空白 500。

本輪本機 sandbox 驗收：

```bash
TARGET_APP_URL=http://localhost:31023 RUN_CLOUDFLARE_SMOKE=true RUN_PAYUNI_SANDBOX_WEBHOOK_SMOKE=true SMOKE_VENDOR_ID=cmrd3zwyn0004vdx0nceozret SMOKE_VENDOR_SLUG=wuhe-select npm run external:smoke
```

結果：

- `health`：PASS
- `admin preflight`：PASS
- `posthog smoke event`：PASS
- `sentry smoke event`：PASS
- `payuni paid webhook`：PASS
- `payuni duplicate webhook`：PASS
- `payuni refunded webhook`：PASS
- `cloudflare direct upload`：FAIL，`Cloudflare Stream request failed: [{"code":10000,"message":"Authentication error"}]`
- `resend test email`：SKIP，`SMOKE_TEST_EMAIL` 未設定

最新 repo 內驗證：

```bash
npm run db:generate
npm run db:migrate:deploy
npm run db:migrate:status
npm run lint
npm run typecheck
npm run test
npm run build
npm run preflight
npm run e2e:smoke
```

結果：

- `db:generate`：通過
- `db:migrate:deploy`：通過
- `db:migrate:status`：Database schema is up to date
- `lint`：通過
- `typecheck`：通過
- `test`：8 個 test files / 20 tests passed
- `build`：通過，60 個 app routes
- `preflight`：通過，仍保留 `NEXT_PUBLIC_SENTRY_DSN` / `RATE_LIMIT_PROVIDER` warning
- `e2e:smoke`：6 tests passed

目前剩餘 External required：

- Cloudflare Stream token / account scope 修正，完成 direct upload、ready webhook、Live Input 真實驗收
- Resend 測試信與 password reset email 實際送達驗證
- staging / production admin MFA enrollment / recovery code smoke

## 9. External Required 收斂更新

新增完成：

- Cloudflare diagnostics 已進入 `/admin/cloudflare/videos` 與 `/api/admin/preflight`。
- Cloudflare diagnostics 只顯示 env presence、長度、API base、endpoint 與錯誤排查，不顯示 token 原文。
- 新增 Cloudflare dashboard checklist：`docs/cloudflare-stream-dashboard-checklist.md`。
- 新增 password reset email smoke action，登入者只能寄給自己。
- 新增 password reset email smoke runbook：`docs/password-reset-email-smoke-runbook.md`。
- 新增 MFA recovery code 重新產生流程，舊 codes 會失效。
- 新增 MFA recovery SOP：`docs/admin-mfa-recovery-sop.md`。
- 新增 production rate limit runbook：`docs/production-rate-limit-runbook.md`。
- E2E 已新增已登入 finance role 未完成 MFA 時不可進入 `/admin/**` 的驗收。

安全審查補充：

- Password reset smoke 不接受任意收件者，避免變成後台濫寄工具。
- Password reset email HTML 已 escape email / reset URL，避免未來改動導致 HTML 注入。
- MFA recovery codes 重新產生會刪除舊 codes，DB 仍只保存 hash。
- MFA verify 的 `next` 參數只允許 same-site relative path，避免 protocol-relative open redirect。
- Cloudflare diagnostics 不主動打 Cloudflare API，避免列表頁造成外部成本或 token probing。

External required 仍未完成：

- Cloudflare `code=10000 Authentication error` 需在 dashboard 修正 token scope / account mapping。
- Cloudflare Stream VOD webhook production 已支援官方 `Webhook-Signature`；`x-cloudflare-stream-webhook-secret` 僅保留為 staging / local smoke fallback。
- Resend domain 與 password reset email deliverability 需實測。
- Production durable rate limit 需切到 Upstash Redis 或 Cloudflare WAF，並完成 checkout / form / analytics / affiliate-clicks 429 驗收。

本輪驗證：

- `npm run lint`：通過
- `npm run typecheck`：通過
- `npm run test`：8 個 test files / 20 tests passed
- `npm run build`：通過，60 個 app routes
- `npm run preflight`：通過；仍有 `NEXT_PUBLIC_SENTRY_DSN` 與 `RATE_LIMIT_PROVIDER` warnings
- `npm run e2e:smoke`：7 tests passed，已包含 MFA admin gate 驗收

## 10. Cloudflare Stream 官方 Webhook 簽章狀態

狀態：Done in repo，External required for real Cloudflare callback。

已完成：

- `/api/cloudflare/stream-webhook` 以 raw body 驗證官方 `Webhook-Signature`。
- 簽章來源字串為 `<time>.<rawBody>`，使用 `CLOUDFLARE_STREAM_WEBHOOK_SECRET` 做 HMAC-SHA256。
- `sig1` 採 constant-time compare。
- `time` 超過 5 分鐘會以 `expired_timestamp` 拒絕。
- 官方 header 存在但簽章錯誤時，不會降級使用 shared secret fallback。
- `x-cloudflare-stream-webhook-secret` 保留作為本機與 staging smoke fallback。
- `/admin/cloudflare/videos` diagnostics 顯示目前 webhook mode。

風險與收斂：

- 真實 Cloudflare VOD webhook signing secret 仍需從 Cloudflare dashboard / API subscription 取得。External required。
- Cloudflare direct upload 目前仍卡在 `code=10000 Authentication error`，需先修正 token scope / account mapping，才能完成 ready webhook 真實驗收。External required。
- Production 應以官方 `Webhook-Signature` 為主；fallback 僅保留給 smoke，不應作為正式 Cloudflare webhook 的主要驗證模式。

本輪驗收：

- Unit test 已覆蓋 official signature、invalid signature、expired timestamp / replay 與 shared secret fallback。
- 本機 HTTP official signature smoke 已通過，回傳 `verificationMode=official-signature`。
- `npm run external:smoke` 中 Cloudflare direct upload 仍因外部 `code=10000 Authentication error` 失敗，PayUni / Sentry / PostHog smoke 通過。

最終 repo 內驗證：

- `npm run lint`：通過。
- `npm run typecheck`：通過。
- `npm run test`：8 個 test files / 25 tests passed。
- `npm run build`：通過，60 個 app routes。
- `npm run preflight`：通過；仍有 `NEXT_PUBLIC_SENTRY_DSN` 與 `RATE_LIMIT_PROVIDER` warnings。
- `npm run e2e:smoke`：7 tests passed。

補強：

- 新增 `npm run cloudflare:fixtures`，可重播 Cloudflare VOD webhook 官方簽章 fixtures。
- fixtures 覆蓋 `ready`、`processing`、`error`、`invalid_signature`、`expired_timestamp`。
- `scripts/external-smoke.ts` 的 Cloudflare ready webhook replay 已改用官方 `Webhook-Signature`。
- Production go-live 前，Cloudflare VOD webhook 必須以官方簽章通過；shared secret fallback 僅可作 staging/local smoke。
- 本機 `npm run cloudflare:fixtures` 已通過：ready / processing / error 回 200，invalid / expired 回 401。
