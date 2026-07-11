# CelebrateDeal External Service Validation Report

最後更新：2026-07-09

## 1. 本輪完成範圍

本輪已完成正式 MVP 上線前全 Phase 的 repo 內接線與可驗收流程。

已完成：

- Staging / production env vars 對照表。
- Supabase / Vercel / Cloudflare / PayUni / Resend / Sentry / PostHog 操作 runbook。
- Production go-live checklist。
- Sentry SDK 實際接線，並移除硬編碼 DSN 與 wizard demo page。
- Protected ops endpoints：
  - `/api/admin/ops/test-email`
  - `/api/admin/ops/test-analytics`
  - `/api/admin/ops/test-monitoring`
- External smoke CLI：`npm run external:smoke`。
- Preflight CLI：`npm run preflight`。

## 2. 已本機驗證

可在無外部真實憑證下驗證：

- Prisma generate。
- PostgreSQL baseline migration。
- Migration status。
- Unit tests。
- Typecheck。
- Production build。
- Preflight with complete placeholder-safe env。

本輪實際驗證結果：

- `npm run db:migrate:deploy`：通過。
- `npm run db:migrate:status`：Database schema is up to date。
- `npm run db:generate`：通過。
- `npm run lint`：通過。
- `npm run typecheck`：通過。
- `npm run test`：3 個 test files / 9 tests passed。
- `npm run build`：Next.js 16 production build 通過，50 個 app routes 完成編譯。
- `npm run preflight`：使用完整測試 env vars 通過。

## 2.1 上線前安全硬化補充

本輪追加完成：

- 管理 / job / ops endpoint 改為缺少 `JOB_SECRET` 時 fail closed。
- Cloudflare direct upload / Live Input 建立 API 加上 Bearer `JOB_SECRET`。
- Cloudflare Stream webhook 改為必須驗證 `CLOUDFLARE_STREAM_WEBHOOK_SECRET`。
- Checkout API 改由後端 Product 決定金額，不再接受前端 `amountCents`。
- 表單提交、前台事件、聯盟點擊與 checkout 加上 repo 內輕量 rate limit。
- Payment webhook 簽章失敗 audit log 不再保存 raw request body。
- `/api/health` 不再回傳原始 DB error。
- ecpay-like provider 移除 demo fallback secret。
- CI 加上 `npm run build` 與 `npm run preflight`。

詳細審查紀錄：`docs/production-readiness-review.md`。

本輪重新驗證結果：

- `npm run db:generate`：通過。
- `npm run db:migrate:deploy`：本機 Docker PostgreSQL 成功套用 3 個 migrations。
- `npm run db:migrate:status`：Database schema is up to date。
- `npm run lint`：通過。
- `npm run typecheck`：通過。
- `npm run test`：3 個 test files / 9 tests passed。
- `npm run build`：Next.js 16 production build 通過，50 個 app routes 完成編譯。
- `npm run preflight`：通過。

## 3. 尚需外部 dashboard 完成

以下項目必須登入外部服務或提供真實 sandbox credentials，無法在本機憑空完成：

| 服務 | 需完成項目 | 驗收方式 |
|---|---|---|
| Supabase | 確認 staging / production `DATABASE_URL` / `DIRECT_URL` | `db:migrate:status` up to date |
| Vercel | 確認 env vars、custom domain、deployment | `/api/health`、`/api/admin/preflight` pass |
| Cloudflare | 填 Stream token，設定 Stream webhook | direct upload / live input / ready webhook pass |
| PayUni | 填 sandbox / production credentials，設定 webhook URL | paid / refunded webhook pass |
| Resend | 驗證 domain，填 API key | test email delivered |
| Sentry | 建 project，填 DSN / source map token | synthetic issue appears |
| PostHog | 建 project，填 project key | `production_smoke_test` event appears |

## 4. 驗收命令

Staging / production env 設定完成後執行：

```bash
npm run db:migrate:deploy
npm run db:migrate:status
npm run preflight
npm run external:smoke
```

Cloudflare mutating smoke test：

```bash
RUN_CLOUDFLARE_SMOKE=true npm run external:smoke
```

Demo payment webhook smoke test：

```bash
RUN_DEMO_PAYMENT_WEBHOOK_SMOKE=true SMOKE_VENDOR_SLUG=your-vendor npm run external:smoke
```

Email smoke test：

```bash
SMOKE_TEST_EMAIL=you@example.com npm run external:smoke
```

## 5. Go-live 判斷

可收費 MVP 的最後門檻：

- `docs/production-go-live-checklist.md` P0 項目全部打勾。
- `docs/external-service-validation-runbook.md` 每個服務的驗收標準都完成。
- PayUni sandbox paid / refunded / duplicate webhook 驗證通過。
- Cloudflare Stream direct upload / ready webhook 驗證通過。
- Supabase restore drill 完成。

## 6. 2026-07-09 Repo Fixture Replay（非 PayUni Dashboard 驗收）

本輪使用本機 dev server `http://localhost:31023` 執行：

```bash
TARGET_APP_URL=http://localhost:31023 \
RUN_CLOUDFLARE_SMOKE=true \
RUN_PAYUNI_SANDBOX_WEBHOOK_SMOKE=true \
SMOKE_VENDOR_ID=cmrd3zwyn0004vdx0nceozret \
SMOKE_VENDOR_SLUG=wuhe-select \
SMOKE_PRODUCT_ID=<active-platform-product-id> \
npm run external:smoke
```

結果：

| 項目 | 結果 | 備註 |
|---|---|---|
| health | PASS | `HTTP 200` |
| admin preflight | PASS | `HTTP 200` |
| posthog smoke event | PASS | `HTTP 200` |
| sentry smoke event | PASS | `HTTP 200` |
| payuni paid webhook | PASS | 已建立 / 更新 `payment_transactions` |
| payuni duplicate webhook | PASS | 已正確回傳 `duplicate=true` |
| payuni refunded webhook | PASS | 已建立 refund 與更新 transaction |
| cloudflare direct upload | FAIL | `Cloudflare Stream request failed: [{"code":10000,"message":"Authentication error"}]` |
| resend test email | SKIP | `SMOKE_TEST_EMAIL` 未設定 |

判讀：

- 此段僅證明 repo 產生的 signed fixture 可通過 adapter、idempotency、refund attribution 與 reconciliation；不等於 PayUni dashboard 或真實 sandbox callback 驗收。
- 最新 smoke 必須先以 `SMOKE_PRODUCT_ID` 呼叫 checkout 建立 pending transaction，才會重播 paid／duplicate／refund；舊版直接使用自製 order number 的結果不再作為 release evidence。
- Cloudflare Stream 目前的阻塞點是外部帳號或 Token 權限，不是 repo 內 direct upload / webhook 寫回邏輯。需修正 Cloudflare account mapping 或 token scope 後，再重跑 ready webhook 與 live input 驗收。External required。
- Resend transactional email 發送程式已接上，但實際送達驗收尚未執行。External required。

## 7. Password Reset / Admin MFA 狀態

本輪已在 repo 內完成：

- Password reset request / confirm UI 與 API。
- Token hash 入庫、30 分鐘過期、使用後失效、成功後 revoke sessions。
- Admin MFA TOTP enrollment / verify。
- Recovery codes hash 入庫。
- `/admin/**` 強制 MFA gate。
- MFA / password reset 操作寫入 `audit_logs`。

這些能力已通過 `lint`、`typecheck`、`test`、`build`、`preflight`、`e2e:smoke`；但 email deliverability 與真實 admin enrollment 仍需 staging / production 實機驗收。External required。

## 8. External Required 收斂狀態

本輪新增 repo 內交付：

| 項目 | 狀態 | 文件 / 入口 |
|---|---|---|
| Cloudflare diagnostics | Done in repo | `/admin/cloudflare/videos`、`/api/admin/preflight` |
| Cloudflare dashboard checklist | Done in repo | `docs/cloudflare-stream-dashboard-checklist.md` |
| Password reset smoke action | Done in repo | `/settings/security`、`/mfa/setup` |
| Password reset smoke runbook | Done in repo | `docs/password-reset-email-smoke-runbook.md` |
| MFA recovery code regeneration | Done in repo | `/settings/security`、`/mfa/setup` |
| MFA recovery SOP | Done in repo | `docs/admin-mfa-recovery-sop.md` |
| Production rate limit runbook | Done in repo | `docs/production-rate-limit-runbook.md` |

仍需外部操作：

- Cloudflare dashboard：修正 token scope / account mapping，排除 `code=10000 Authentication error`。External required。
- Cloudflare VOD webhook：repo 已支援官方 `Webhook-Signature`；shared secret 僅保留為 staging / local smoke fallback。真實 Cloudflare callback 仍需 signing secret 與 dashboard 回呼驗收。External required。
- Resend：驗證 sender domain，確認 password reset email delivered。External required。
- Upstash / Cloudflare WAF：啟用 durable rate limit，確認 checkout / form / analytics / affiliate-clicks 可被 429 或 edge block。External required。

最新驗收重點：

- `/api/admin/preflight` 現在會回傳 `cloudflare` diagnostics 與 `rateLimit` 狀態。
- `/admin/cloudflare/videos` 顯示 Cloudflare env presence 與錯誤排查，不顯示 secret。
- MFA E2E 已覆蓋 signed-in finance role 未完成 MFA 不可進 `/admin/**`。

本輪 repo 內驗證：

- `lint`：通過
- `typecheck`：通過
- `test`：8 個 test files / 20 tests passed
- `build`：通過
- `preflight`：通過；仍有 production 建議 warning
- `e2e:smoke`：7 tests passed

## 9. Cloudflare Stream Webhook 簽章驗收更新

Repo 內新增完成：

| 項目 | 狀態 | 備註 |
|---|---|---|
| 官方 `Webhook-Signature` 驗證 | Done in repo | raw body + `time` + `sig1` + HMAC-SHA256 |
| replay / expired timestamp 防護 | Done in repo | 超過 5 分鐘回 401 |
| invalid signature 防護 | Done in repo | 官方 header 錯誤時不 fallback |
| shared secret fallback | Done in repo | 僅作 staging / local smoke |
| admin diagnostics webhook mode | Done in repo | `/admin/cloudflare/videos` |

目前外部驗收狀態：

- Cloudflare direct upload 仍因 `code=10000 Authentication error` 未通過。External required。
- 需先在 Cloudflare dashboard 修正 account id / token scope，再重跑 `RUN_CLOUDFLARE_SMOKE=true npm run external:smoke`。
- 需建立或讀取 Cloudflare Stream VOD webhook subscription，取得 webhook signing secret，設定 `CLOUDFLARE_STREAM_WEBHOOK_SECRET` 後重跑真實 ready callback。External required。

本輪本機 staging-style smoke：

```bash
TARGET_APP_URL=http://localhost:31023 RUN_CLOUDFLARE_SMOKE=true RUN_PAYUNI_SANDBOX_WEBHOOK_SMOKE=true SMOKE_VENDOR_ID=cmrd3zwyn0004vdx0nceozret SMOKE_VENDOR_SLUG=wuhe-select npm run external:smoke
```

結果：

| 項目 | 結果 | 備註 |
|---|---|---|
| health | PASS | `HTTP 200` |
| admin preflight | PASS | `HTTP 200` |
| posthog smoke event | PASS | `HTTP 200` |
| sentry smoke event | PASS | `HTTP 200` |
| payuni paid webhook | PASS | 建立 / 更新 transaction |
| payuni duplicate webhook | PASS | 回傳 `duplicate=true` |
| payuni refunded webhook | PASS | 建立 refund 並更新 transaction |
| cloudflare direct upload | FAIL | Cloudflare API 回 `code=10000 Authentication error` |
| resend test email | SKIP | `SMOKE_TEST_EMAIL` 未設定 |

另外已用本機 HTTP request 驗證 official signature route：

```bash
POST /api/cloudflare/stream-webhook
Webhook-Signature: time=<now>,sig1=<hmac-sha256>
```

回傳：

```json
{"ok":true,"updated":0,"verificationMode":"official-signature"}
```

判讀：repo 內官方簽章驗證與 route wiring 已可運作；Cloudflare 真實 callback 仍受外部 token / account mapping 阻塞。

本輪最終驗證：

- `lint`：通過。
- `typecheck`：通過。
- `test`：8 個 test files / 25 tests passed。
- `build`：通過，60 個 app routes。
- `preflight`：通過；仍有 `NEXT_PUBLIC_SENTRY_DSN` 與 `RATE_LIMIT_PROVIDER` warnings。
- `e2e:smoke`：7 tests passed。

## 10. Cloudflare Fixture Replay 補強

本輪新增 repo 內交付：

| 項目 | 狀態 | 備註 |
|---|---|---|
| `src/lib/cloudflare-webhook-fixtures.ts` | Done in repo | 產生 ready / processing / error / invalid / expired 官方簽章 payload |
| `scripts/cloudflare-webhook-fixtures.ts` | Done in repo | 可用 `npm run cloudflare:fixtures` 重播 |
| external smoke ready replay | Done in repo | direct upload 成功後改用官方 `Webhook-Signature` replay，不再用 fallback |
| route unit tests | Done in repo | 已覆蓋 ready / processing / error / invalid / expired / fallback |

Staging 建議驗收命令：

```bash
TARGET_APP_URL=https://<staging-domain> CLOUDFLARE_STREAM_WEBHOOK_SECRET=<signing-secret> npm run cloudflare:fixtures
```

預期：

- `ready`：PASS / HTTP 200
- `processing`：PASS / HTTP 200
- `error`：PASS / HTTP 200
- `invalid_signature`：PASS / HTTP 401
- `expired_timestamp`：PASS / HTTP 401

本機 fixture replay 實測結果：

```bash
TARGET_APP_URL=http://localhost:31023 CLOUDFLARE_STREAM_WEBHOOK_SECRET=stream-secret npm run cloudflare:fixtures
```

結果：

| Fixture | 結果 | 回應 |
|---|---|---|
| ready | PASS | HTTP 200 / `verificationMode=official-signature` |
| processing | PASS | HTTP 200 / `verificationMode=official-signature` |
| error | PASS | HTTP 200 / `verificationMode=official-signature` |
| invalid_signature | PASS | HTTP 401 / `reason=invalid_signature` |
| expired_timestamp | PASS | HTTP 401 / `reason=expired_timestamp` |

仍待 External required：

- Cloudflare dashboard 修正 token / account 後，才能完成 direct upload、ready webhook、Live Input 真實驗收。
- 真實 VOD webhook signing secret 需從 Cloudflare Stream webhook subscription 取得，不能使用 local smoke secret。

## 11. 2026-07-11 Repo-local Staging Handoff

Repo 內 adapter、fixture、diagnostics、redaction、retry、reconciliation、preflight 與 staging workflow 均已具備；PayUni smoke 現在會先透過 checkout 建立 pending transaction，再重播 paid／duplicate／refund fixture。本輪未使用或提交任何真實 secret，也未執行 production deployment。

外部驗收仍須依序完成：

1. Supabase staging migration、health check、snapshot/restore drill。
2. Vercel staging env 與 protected deployment。
3. Cloudflare Stream token/account 修正後，direct upload、Live Input、真實 official-signature ready callback。
4. PayUni sandbox checkout、paid/refunded/duplicate webhook 與 reconciliation。
5. Resend verified domain、password reset 與通知實收。
6. Upstash Redis 或 Cloudflare WAF durable rate limit smoke。
7. Sentry/PostHog event、source map/funnel 與 alert rules。

以上均為 `External required`，不因本機 fixture 通過而視為完成。

Repo-local release gate 於 2026-07-11 更新為：25 migrations、169 tests、72-route build、13 smoke、7 axe、32 visual comparisons 與 Lighthouse。新增逐交易 paymentMode 月結、晚到退款跨月 carry ledger、immutable paid fee snapshot、processed-only RefundRecord counter trigger、composite tenant FK、DB caps、按月 lock、clean deploy、legacy/missing-subscription fail-closed 與 atomic partial-failure drills。這些結果只允許進入 Staging 外部驗收，不替代上列 dashboard/sandbox evidence。
