# CelebrateDeal Production Go-live Checklist

最後更新：2026-07-09

## 1. 外部服務勾核

- [ ] Domain registrar 已確認（External required）
- [ ] Cloudflare zone 已接管 DNS（External required）
- [ ] Cloudflare WAF baseline 已啟用（External required）
- [ ] Vercel project 已連 GitHub repo（External required）
- [ ] Supabase staging project 已建立（External required）
- [ ] Supabase production project 已建立（External required）
- [ ] PayUni sandbox credentials 已取得（External required）
- [ ] PayUni production 申請已送出或核准（External required）
- [ ] Resend domain 已驗證（External required）
- [ ] Sentry staging / production project 已建立（External required）
- [ ] PostHog staging / production project 已建立（External required）

## 2. Staging 驗收

- [ ] Vercel Preview / staging env vars 已設定
- [ ] `npm run db:migrate:deploy` 對 staging DB 成功
- [ ] `npm run db:migrate:status` 顯示 up to date
- [ ] `npm run preflight` 通過
- [ ] CI `lint / typecheck / test / e2e:smoke / build / preflight` 全部通過
- [ ] `/api/health` 回傳 DB ok
- [ ] `/api/admin/preflight` 回傳 ok
- [ ] `/api/admin/preflight` 顯示 production durable rate limit provider，不是 `memory`（External required）
- [ ] Upstash Redis provider 使用 staging REST URL / token 驗證，或 Cloudflare WAF rule 已啟用（External required）
- [ ] 缺少或錯誤 Bearer `JOB_SECRET` 時，admin ops / Cloudflare 建立資源 API 回 401
- [ ] Server Actions 表單含 CSRF token，跨站 Origin 測試被拒絕
- [ ] Public JSON POST 缺少 `X-CelebrateDeal-Client: web` 被拒絕
- [ ] CSP report-only 已出現在 response headers
- [ ] `/api/security/csp-report` 可接收 report，且受 rate limit 保護
- [ ] Cloudflare direct upload 建立 upload URL 成功，且寫回 video mapping（External required）
- [ ] Cloudflare Stream token / account mapping 已驗證，不再出現 `code=10000 Authentication error`（External required）
- [ ] `/admin/cloudflare/videos` diagnostics 顯示 Cloudflare env ready，且未顯示 token 原文
- [ ] `/api/admin/ops/cloudflare/direct-upload` 可建立 direct upload mapping（External required）
- [ ] Cloudflare Stream webhook 可更新 video ready 狀態（External required）
- [ ] Cloudflare VOD webhook 已使用官方 `Webhook-Signature`，且 `CLOUDFLARE_STREAM_WEBHOOK_SECRET` 設為 Cloudflare webhook signing secret（External required）
- [ ] Cloudflare Stream webhook 缺少、錯誤或過期官方簽章時回 401
- [ ] `x-cloudflare-stream-webhook-secret` fallback 僅用於 staging / local smoke，不作為 production 主要驗證
- [ ] `npm run cloudflare:fixtures` 在 staging 通過 ready / processing / error / invalid / expired fixtures
- [ ] Cloudflare Live Input 建立成功，response 不回傳明文 stream key（External required）
- [ ] `/admin/cloudflare/videos` 可看到 ready 狀態、playback URL 與 streamKeyRef
- [ ] Checkout API 使用 Product price 建立 transaction，任意前端金額不可影響訂單金額
- [ ] PayUni sandbox checkout redirect / form post 成功（External required）
- [ ] PayUni sandbox paid webhook 成功建立 payment transaction（External required）
- [ ] PayUni sandbox refunded webhook 成功建立 refund record（External required）
- [ ] PayUni duplicate webhook 不重複入帳（External required）
- [ ] `/admin/billing/webhooks/:id` PayUni diagnostics 顯示 HashInfo verification pass
- [ ] password reset request / confirm API 可建立 token、重設密碼並 revoke sessions
- [ ] `/password-reset/request` 與 `/password-reset/confirm` UI smoke 通過
- [ ] 安全中心 password reset smoke action 可寄送目前帳號 reset email
- [ ] password reset email 已透過 Resend 送達（External required）
- [ ] Admin MFA setup / verify / recovery code 流程通過，未完成 MFA 的 admin 無法進入 `/admin/**`
- [ ] Admin 可重新產生 recovery codes，舊 codes 失效
- [ ] Reconciliation detail 顯示 pass
- [ ] Resend test email 送達（External required）
- [ ] Sentry synthetic issue 出現在 dashboard（External required）
- [ ] PostHog `production_smoke_test` event 出現在 dashboard（External required）

## 3. Production 驗收

- [ ] Vercel production env vars 已設定
- [ ] Production migration 前備份已建立（Supabase managed snapshot 或已簽核的加密自管邏輯備份）
- [ ] `npm run db:migrate:deploy` 對 production DB 成功
- [ ] `npm run db:migrate:status` 顯示 up to date
- [ ] `SEED_MODE=production-bootstrap npm run db:seed` 成功
- [ ] `npm run preflight` 通過
- [ ] CI `lint / typecheck / test / e2e:smoke / build / preflight` 全部通過
- [ ] `/api/health` 回傳 DB ok
- [ ] `/api/admin/preflight` 回傳 ok
- [ ] `/api/admin/preflight` 顯示 `RATE_LIMIT_PROVIDER=cloudflare_waf` 或 `upstash_redis`
- [ ] `RATE_LIMIT_PROVIDER=upstash_redis` 時，`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 已設定（External required）
- [ ] checkout / form-submissions / analytics / affiliate-clicks rate limit smoke 可看到 429 或 edge block
- [ ] Secret-protected endpoints 以錯誤 Bearer token 測試皆回 401
- [ ] CSRF / same-origin smoke 通過
- [ ] CSP report-only 已觀察 24 小時且未發現會阻斷核心流程的來源
- [ ] 平台 admin MFA TOTP enrollment / verify / recovery code 實測通過
- [ ] MFA 遺失裝置 SOP 已演練，含 recovery code 與人工 reset 流程
- [ ] Production smoke routes 可登入並開啟
- [ ] Cloudflare Stream token / account mapping 已驗證，不再出現 `code=10000 Authentication error`（External required）
- [ ] Cloudflare VOD webhook signing secret 已設定，官方 `Webhook-Signature` 真實回呼驗收通過（External required）
- [ ] Production `npm run cloudflare:fixtures` 已針對 production domain 驗證官方簽章處理
- [ ] PayUni production webhook URL 已設定（External required）
- [ ] password reset email 與 reset confirm 流程在 production domain 實測通過（External required）
- [ ] Resend production sender 可寄信（External required）
- [ ] Sentry production alert rule 已設定（External required）
- [ ] PostHog production project 可收到事件（External required）

## 4. Go / No-go

正式收費前必須全部通過：

- [ ] Staging 全部 P0 測試通過
- [ ] Production DB backup 完成（managed snapshot 或加密自管邏輯備份）
- [ ] Backup restore drill 完成（隔離 target、目標／實測 RTO、aggregate 一致性均已簽核）
- [ ] PayUni checkout / paid / refunded / duplicate webhook 通過（External required）
- [ ] Cloudflare Stream upload / live input / ready webhook 通過（External required）
- [ ] Sentry alert 可收到測試錯誤（External required）
- [ ] Rollback plan 已演練

簽核：

- Owner：
- Date：
- Notes：
