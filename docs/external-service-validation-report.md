# CelebrateDeal External Service Validation Report

最後更新：2026-08-21

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

## 6. 2026-07-09 Sandbox 閉環實測結果

本輪使用本機 dev server `http://localhost:31023` 執行：

```bash
TARGET_APP_URL=http://localhost:31023 \
RUN_CLOUDFLARE_SMOKE=true \
RUN_PAYUNI_SANDBOX_WEBHOOK_SMOKE=true \
SMOKE_VENDOR_ID=cmrd3zwyn0004vdx0nceozret \
SMOKE_VENDOR_SLUG=wuhe-select \
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

- PayUni sandbox webhook 閉環在本機已可重播驗收，代表 provider adapter、idempotency、refund attribution、reconciliation 基本流程可用。
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

## 11. 2026-08-21 current-state reconciliation

本節 supersede 早期段落中的 current-state 描述；早期 smoke 結果保留為歷史 evidence，不重新宣稱為現況。

### Local release candidate

- Release candidate：`352a3dc`；current evidence checkpoint：`docs/launch/current-release-completion-audit-20260821.md` 與 `docs/launch/evidence-index.md`。文件 checkpoint 以目前 Git history 為準，避免沿用過期 commit reference。
- ESLint `0 errors／0 warnings`、TypeScript、strict-index、current release handoff contract `1/1`、`test:release-readiness` `5/5`、readiness truth reconciliation `PASS`、staging migration evidence contract `5/5`、staging migration receipt validator `9/9`、human owner acceptance validator `10/10`、release evidence bundle validator `12/12`、external smoke output safety `12/12`、external provider evidence `12/12`、provider receipt validator `8/8`、Node TAP `814/814`、combined coverage `404 files passed／1 skipped`、`3084 passed／1 skipped`、exit `0`（statements／branches／functions／lines=`64.63／64.32／70.89／69.52`）、controlled production build、local release verifier、secret scan、diff check 與 `npm audit --omit=dev --audit-level=high`（`0 vulnerabilities`）均已通過；PayUni deployment-boundary synthetic env test `33/33`，CI workflow 也已加入同一明確 gate；AI Team server `7/7`、resilience 與 backup tooling static checks 亦通過。
- 這些結果只證明 local／disposable source quality，不取代外部 provider、實際 staging 或真人 acceptance。

`c088754` 的 env preflight 會在 PayUni provider 被選用時，將 Vercel Preview 綁定到 `sandbox`、Production 綁定到 `production`；不一致或缺少設定會 fail closed，CI 會獨立執行這組 contract，並執行 release readiness、readiness truth、staging migration evidence、external smoke output safety 與 provider-specific external evidence contracts。這是設定邊界與輸出安全的本機 synthetic evidence，不代表 PayUni account、order、provider reference 或 reconciliation 已完成。

2026-08-21 的 remote CI 唯讀查詢顯示 `codex/one-stop-webinar-flow` branch head 仍為舊提交 `c2aa2201`；最新列出的 `ci.yml` run `32209974601` 的 `Production dependency audit` step 為 `failure`，且沒有 `352a3dc` 的 run。current RC 的 remote workflow 狀態因此維持 `NOT_PROVEN`；本次沒有 push 或 workflow dispatch。

### Read-only staging probe

2026-08-21 對 `https://celebrate-deal-staging.carry-digital-nomad.in.net` 執行只讀 GET：`/api/health` 為 HTTP `200`、`ok=true`、`database=ok`；公開 `/` 為 HTTP `200`；未帶認證的 `/api/admin/preflight` 為 HTTP `401`。WP-187 lineage marker endpoint 回 HTTP `200`，但不是預期 lineage JSON contract，因此 current RC deployment identity 仍 `NOT_PROVEN`。完整 sanitized evidence：`docs/ai-team/evidence/rel-20260821-staging-readonly-health.md`。

本 probe 沒有讀取憑證、`.env*`、Cookie 或 token，沒有登入、資料庫寫入、付款、退款、寄信、部署或 Production side effect。

### External gate status

| Gate | Current status | Evidence boundary |
|---|---|---|
| Cloudflare Stream | `PENDING_EXTERNAL` | 歷史 direct upload 曾回 `code=10000 Authentication error`；current account／token scope／VOD webhook 未重新驗證 |
| Resend | `PENDING_EXTERNAL` | repo wiring 與 local contract 有證據；真實 domain、寄件與 delivered receipt 未完成 |
| Sentry | `PENDING_EXTERNAL` | local monitoring route／contract 有證據；外部 issue、alert、通知 delivery 未完成 |
| PostHog | `PENDING_EXTERNAL` | local analytics route／contract 有證據；外部 project event receipt 未完成 |
| Durable rate limit | `PENDING_EXTERNAL` | local provider contract 有證據；Cloudflare WAF／Upstash durable enforcement 未完成 |
| PayUni Sandbox reconciliation | `PENDING_EXTERNAL` | local webhook／refund fixtures、deployment-boundary env preflight 與 `docs/ai-team/evidence/rel-20260821-payuni-callback-host-preflight.md` 有證據；最新只讀 callback-host preflight 為 `BLOCKED`，current staging order、provider reference、amount、status、refund／callback consistency 未完成 |

`PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false` 保持不變。正式公開販售仍為 `NO-GO`；目前可維持 local、Sandbox 或不收真實款項的封閉試用。

## 12. 2026-08-21 external smoke output safety contract

本輪新增的 `scripts/external-smoke-safety.ts` 將 response 與 runner error 轉換成固定 allowlist 分類；`scripts/external-smoke.ts` 仍可在記憶體內讀取 response 來判斷檢查結果，但 stdout 不再輸出 raw response、Cloudflare UID／stream key reference、PayUni order／provider payload 或原始錯誤訊息。CI 已加入 `External smoke output safety contract` step。

本機 targeted 結果：`npx vitest run scripts/external-smoke-safety.test.ts` 為 `12/12`；完整 coverage rerun 為 `404 files passed／1 skipped`、`3084 passed／1 skipped`，disposable database 與 cleanup 均 `PASS`；未呼叫 Cloudflare、Resend、Sentry、PostHog、rate-limit provider、PayUni、staging 或 Production。這是 `PASS_LOCAL_ONLY` 的 evidence safety contract，不改變前述六個 external gates 的 `PENDING_EXTERNAL` 狀態。

## 13. 2026-08-21 provider-specific sanitized evidence contract

本輪新增 `scripts/external-provider-evidence.mjs` 與 `scripts/external-provider-evidence.test.mjs`，把六個 external gate 的最小 receipt 收斂成固定 schema：Cloudflare Stream、Resend、Sentry、PostHog、durable rate limit 與 PayUni Sandbox 各自有明確的成功欄位與 closed enum。`PASS` 必須同時具備 non-Production identity、已驗證 provider environment、至少一次 bounded attempt、opaque evidence reference、provider operation evidence 與固定 side-effect budget；`PENDING_EXTERNAL`、`FAILED`、`BLOCKED`、`PENDING_HUMAN` 則需要對應的 closed reason，不可用未知值偽裝成成功。

receipt validator 會遞迴拒絕 raw output、raw provider response、URL、Token、Cookie、email、order／trade number、provider reference、connection string、絕對路徑與未知 nested key；safety flags、Production operations、deployments、payments、refunds、callback replays 必須保持零。PayUni 額外要求 `providerWriteRequests=0`，因此這份契約不能授權付款、退款、callback replay 或 Production 操作。

本機 targeted 結果：`node --test scripts/external-provider-evidence.test.mjs` 為 `12/12`；納入 combined coverage 後完整 Node TAP 為 `775/775`，combined coverage 為 `404 files passed／1 skipped`、`3084 passed／1 skipped`，statements／branches／functions／lines=`64.36／64.00／70.50／69.23`，disposable database 與 cleanup 均 `PASS`；CI 已加入 `External provider evidence contract` step。測試中的每個 `PASS` 都是 synthetic contract fixture，沒有呼叫或驗證任何 Cloudflare、Resend、Sentry、PostHog、rate-limit provider、PayUni、staging 或 Production；六個 external gates 仍為 `PENDING_EXTERNAL`，`SANDBOX_READY=false`、`PRODUCTION_READY=false` 與正式販售 `NO-GO` 維持不變。

## 14. 2026-08-21 provider receipt validation CLI

`75e5519` 新增 `scripts/validate-external-provider-evidence.mjs` 與對應的 `scripts/validate-external-provider-evidence.test.mjs`。CLI 僅能讀取 `docs/ai-team/evidence` 或 `.ai-team/reports` 下、符合固定檔名規則的 receipt JSON，透過同一個 provider receipt schema 做 read-only validation，輸出只包含 `PASS／FAIL`、provider、result、sanitized 或固定 failure reason；它不呼叫 network、不讀取 environment、不啟動 child process、不寫檔，也不把 `PENDING_EXTERNAL` 轉成 provider PASS。

本機 targeted 結果：provider contract 與 CLI contract 合計 `19/19`；完整 Node TAP `782/782`；combined coverage `404 files passed／1 skipped`、`3084 passed／1 skipped`，statements／branches／functions／lines=`64.39／64.04／70.52／69.25`，disposable database 與 cleanup 均 `PASS`。這只提高 sanitized receipt 的輸入驗證與追溯性，沒有呼叫 Cloudflare、Resend、Sentry、PostHog、rate-limit provider、PayUni、staging 或 Production；六個 external gates、`PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false` 與正式販售 `NO-GO` 維持不變。

## 15. 2026-08-21 staging migration receipt validation CLI

`1ceb9a5` 新增 `scripts/validate-staging-migration-evidence.mjs` 與對應測試，並補強 provider receipt validator 的 canonical `realpath` boundary。兩個 CLI 都只讀安全 evidence roots，拒絕 traversal、敏感檔名與 symlink 指向 root 外的檔案；不執行 migration、不連資料庫、不呼叫 provider、不讀取 environment、不啟動 child process，也不寫入 evidence。

本機 targeted 結果：provider schema／CLI 與 staging migration CLI 合計 `29/29`，其中 staging migration receipt validator `9/9`、provider receipt validator `8/8`；完整 Node TAP `792/792`；combined coverage `404 files passed／1 skipped`、`3084 passed／1 skipped`，statements／branches／functions／lines=`64.49／64.15／70.64／69.36`，disposable database 與 cleanup 均 `PASS`。這只補強 sanitized receipt 的輸入安全與追溯性，沒有呼叫 Cloudflare、Resend、Sentry、PostHog、rate-limit provider、PayUni、staging 或 Production；staging migration、六個 external gates、`PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false` 與正式販售 `NO-GO` 維持不變。

## 16. 2026-08-21 human owner acceptance receipt validation CLI

`8e8fe08` 新增 `scripts/validate-human-owner-acceptance-evidence.mjs` 與對應測試，並在 CI 加入 `Human owner acceptance evidence contract`。CLI 驗證 CAT10 packet 的五個 responsibility role、每個 required check、政策狀態、客服 escalation、opaque holder／evidence references、法律 self-review boundary 與 release decision consistency；它只讀 sanitized receipt，拒絕 synthetic reference、敏感欄位、Production approval、缺漏責任或 `GO` 搭配未完成 evidence。

本機 targeted 結果：human owner acceptance validator `10/10`、targeted ESLint、Node syntax 與 diff check 均 `PASS`；完整 Node TAP `802/802`；combined coverage `404 files passed／1 skipped`、`3084 passed／1 skipped`，statements／branches／functions／lines=`64.56／64.24／70.77／69.44`。此 validator 只證明輸入 receipt 可以被安全解析；目前沒有真人 acceptance receipt，CAT10 仍為 `PENDING_HUMAN`，也沒有把 `CANDIDATE` 升格為 human approval、法務意見、外部 monitoring、`SANDBOX_READY` 或 `PRODUCTION_READY`。本輪沒有呼叫 Cloudflare、Resend、Sentry、PostHog、rate-limit provider、PayUni、staging 或 Production。

## 17. 2026-08-21 release evidence bundle aggregation gate

`352a3dc` 新增 `scripts/validate-release-evidence-bundle.mjs` 與對應測試，並在 CI 加入 `Release evidence bundle contract`。bundle schema 固定要求 current source commit、non-Production boundary、13 個必要 gate：remote CI、staging lineage／migration／recovery／rollback、Cloudflare、Resend、Sentry、PostHog、durable rate limit、PayUni Sandbox reconciliation、policy review 與 human owner acceptance。每個 gate 必須使用同一 source lineage、opaque evidence／owner／scope references、closed result／failure codes 與 `sanitized=true`；`GO` 遇到任何非 `PASS` gate 會 fail closed。

本機 targeted 結果：release evidence bundle validator `12/12`、full lint、TypeScript、strict-index、current release handoff、readiness truth、完整 Node TAP `814/814`、combined coverage `404 files passed／1 skipped`、`3084 passed／1 skipped`，statements／branches／functions／lines=`64.63／64.32／70.89／69.52`，disposable database 與 cleanup 均 `PASS`。另已保存 `docs/ai-team/evidence/release-evidence-bundle-current-status-20260821.json`，以 current source `352a3dc` 實際驗證為 `PASS; result=INCOMPLETE`，如實固定 13 個 gate 的未完成狀態。這是 current status baseline 與 local contract evidence；它不代表所有 gate 已完成，也不改變 `PENDING_EXTERNAL`、`PENDING_HUMAN`、`SANDBOX_READY=false`、`PRODUCTION_READY=false` 與正式販售 `NO-GO`。這個 contract checkpoint 本身沒有呼叫外部 provider、PayUni、staging 或 Production；後續只讀 callback-host preflight 的結果見第 18 節。

## 18. 2026-08-21 PayUni callback-host preflight

本輪只讀 preflight 使用目前 process environment 的 Sandbox 設定，執行 callback host `/api/health` reachability check。結果為 `BLOCKED`，觀察到的固定 error class 為 `PayUniCallbackHostError`；只發出 1 次 health GET，`paymentRequests=0`、`refundRequests=0`、`callbackReplays=0`、`productionOperations=0`。完整 sanitized evidence 見 `docs/ai-team/evidence/rel-20260821-payuni-callback-host-preflight.md` 與 machine-readable receipt `rel-20260821-payuni-callback-host-preflight-evidence.json`；既有 provider receipt validator 結果為 `PASS`，receipt result 保留為 `BLOCKED`。

這次沒有建立 Sandbox 訂單、付款、退款或 callback replay，因此沒有產生 reconciliation receipt；PayUni Sandbox、staging lineage、migration、recovery 與 rollback gates 維持未完成。相同 callback-host 路徑不重試，需由 owner 提供可公開連線、明確 non-Production 的 staging callback host 與受控 authorization record 後再執行。
