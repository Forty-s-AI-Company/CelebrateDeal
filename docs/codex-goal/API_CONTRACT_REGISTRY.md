# CelebrateDeal API Contract Registry

最後更新：2026-07-25 19:22（Asia/Taipei）

基準 revision：`35d8f59341bc`

## 共用契約

- 所有 `readJsonBody`／`readFormDataBody` 呼叫預設以 64 KiB 上限讀取 request body；超量、畸形或無法讀取的內容會交由 Zod schema 正規化為 400。
- Cookie-authenticated JSON write route 先驗證 same-origin 與 `x-celebratedeal-client: web`；Server Actions 另由 `assertServerActionSecurity` 統一驗證。
- `JOB_SECRET` 使用 Bearer token、嚴格兩段解析與 timing-safe comparison；沒有設定時 fail closed。
- Provider webhook 使用原始 body 驗證簽章，再做 runtime schema validation。
- 受保護資源的 tenant／ownership 判斷位於 route 或 domain layer；不存在、跨 tenant 與拒絕存取盡量回傳相同 404，避免資源探測。
- 每條 route 都有同路徑 `route.test.ts`。本 registry 另外標示仍需 DB／browser／外部平台證據的 contract。

## Route handlers

| # | Route／method | Caller 與安全邊界 | Input contract | Tenant／resource boundary | Side effect 與 replay contract | Response／error contract | 目前證據 |
|---:|---|---|---|---|---|---|---|
| 1 | `GET /(app)/billing/invoices/export` | `requireVendorContext` | 無 body | query 固定目前 `vendorId` | 只讀 CSV export；公式字元 neutralization | CSV attachment；不回傳其他 vendor | 同路徑 unit |
| 2 | `GET /admin/billing/payouts/[id]/csv` | `requireFinanceAdmin` + platform MFA | bounded route param | platform payout batch；不存在與拒絕同為 404 | 只讀 CSV export | CSV attachment 或安全 404 | 同路徑 unit |
| 3 | `POST /api/admin/ops/cloudflare/direct-upload` | timing-safe `JOB_SECRET` | Zod `DirectUploadRequest`，64 KiB | Production Cloudflare account 由 server env 綁定 | 建立一次 provider direct-upload operation；每次呼叫可能建立新 operation | 400／401／502 使用泛化錯誤 | 同路徑 provider fixture；exact binding 為人工 gate |
| 4 | `POST /api/admin/ops/cloudflare/live-input` | timing-safe `JOB_SECRET` | Zod `LiveInputRequest`，64 KiB | Production Cloudflare account 由 server env 綁定 | 建立一次 provider live input；無 client idempotency key | 400／401／502 使用泛化錯誤 | 同路徑 provider fixture；exact binding 為人工 gate |
| 5 | `POST /api/admin/ops/test-analytics` | timing-safe `JOB_SECRET` | 無外部可控 payload | server-selected synthetic event | 每次呼叫送出一筆測試 analytics event；沒有 replay key | 401 或 `{ ok, result }` | 同路徑 unit；delivery 為人工 gate |
| 6 | `POST /api/admin/ops/test-email` | timing-safe `JOB_SECRET` | Zod bounded payload，64 KiB；收件人必須等於受控設定 | 不接受任意收件人 | 每次成功呼叫寄送一封測試信；沒有 replay key | 400／401／403／503／502 使用泛化錯誤 | 同路徑 unit；delivery 為人工 gate |
| 7 | `POST /api/admin/ops/test-monitoring` | timing-safe `JOB_SECRET` | 無 body | server-selected synthetic issue | 每次呼叫建立一次 Sentry test event | 401 或 `{ ok }` | 同路徑 unit；delivery 為人工 gate |
| 8 | `GET /api/admin/preflight` | timing-safe `JOB_SECRET` | 無 body | platform runtime metadata only | 只讀，不揭露 secret value | 401 或 bounded readiness JSON | 同路徑 unit |
| 9 | `POST /api/affiliate-clicks` | same-origin + client marker + 60/min rate limit | Zod bounded JSON，64 KiB | vendor、active live 與 referral 都由 DB 驗證；visitor ID 為 server cookie | append click、team attribution 與 HttpOnly cookies；沒有 client replay key | 400／403／404／429 或 `{ ok }` | route/domain negative unit；D-002 尚待產品決策 |
| 10 | `POST /api/analytics` | same-origin + client marker + 120/min rate limit | Zod bounded event union，64 KiB | vendor/live pair 與 product/live binding 必須存在 | append-only analytics event；沒有 client replay key | 400／403／404／429 或 `{ ok }` | route lifecycle/product binding unit；D-001 尚待產品決策 |
| 11 | `POST /api/auth/password-reset/request` | same-origin + client marker + 5/min rate limit | Zod email schema，64 KiB | account existence 不回傳給 caller | revoke 舊 token、建立新 token、寄送受控 Email；回應不洩漏 account existence | 400／403／429 或固定成功訊息 | unit；Email delivery 為人工 gate |
| 12 | `POST /api/auth/password-reset/confirm` | same-origin + client marker + 10/min rate limit | Zod token/password schema，64 KiB | token hash + expiry + unused predicate | DB conditional claim；同一 token 只能成功一次；成功後 revoke sessions | 400／403／429 或 `{ ok }` | isolated PostgreSQL sequential + concurrent regression |
| 13 | `POST /api/cloudflare/direct-upload` | timing-safe `JOB_SECRET` | Zod `DirectUploadRequest`，64 KiB | server-side provider account | 與 admin ops direct-upload 相同；每次呼叫可能建立新 provider operation | 泛化 4xx／5xx | 同路徑 provider fixture |
| 14 | `POST /api/cloudflare/live-inputs` | timing-safe `JOB_SECRET` | Zod `LiveInputRequest`，64 KiB | server-side provider account | 與 admin ops live-input 相同；無 client idempotency key | 泛化 4xx／5xx | 同路徑 provider fixture |
| 15 | `POST /api/cloudflare/stream-webhook` | official raw-body signature | raw body 64 KiB + Zod payload | provider UID 必須唯一對應本地 Video；ambiguous mapping fail closed | conditional status claim；`ready`／`error` 不被 stale `processing` 降級，`ready` 可從 `error` 復原 | 400／401／409／413 或 `{ ok, updated }` | unit + isolated PostgreSQL route regression |
| 16 | `POST /api/form-submissions` | JSON same-origin + client marker；native form same-origin browser semantics；10/min rate limit | JSON／form data 64 KiB；form-config allowlist；最多 32 欄、每欄 2,000 chars | active form；live 必須同 vendor、綁定 form 且可公開；blacklist normalized | deterministic primary ID 令同 form/live/email replay 收斂為單筆；attribution 只寫第一次 | JSON 或 same-origin 303；cookie HttpOnly/Lax/30min | route unit；DB concurrent replay 本輪補強 |
| 17 | `GET /api/health` | public read-only | 無 body | 僅 DB probe 與安全分類 | 無寫入 | 200 `{ ok, database, latencyMs }`；失敗 503，不回原始 Prisma message/meta | route/logger unit + Staging/Production 歷史 runtime |
| 18 | `POST /api/jobs/webhook-retry` | timing-safe `JOB_SECRET` | 無 body | platform due queue | 先釋放過期 reservation；retry worker 使用 atomic claim，processed event 不重跑 | 401 或 bounded aggregate result | unit + isolated PostgreSQL retry regression |
| 19 | `POST /api/payments/checkout` | same-origin + client marker + 20/min rate limit | Zod vendor/product/referral，64 KiB | active product 必須屬於 vendor；attribution 只信任 server cookies/DB | SERIALIZABLE 建立 pending transaction + unique inventory reservation；provider/metadata 失敗會標記失敗並釋放庫存；目前無 caller idempotency key | 400／403／404／409／429／502 或 no-store checkout contract | route + inventory concurrency unit/DB；provider Sandbox/Production 為外部 gate |
| 20 | `POST /api/security/csp-report` | public + 120/min rate limit | raw text 16 KiB | 僅 security telemetry | 目前驗證大小後丟棄；無 DB side effect | 204；超量 413 | 同路徑 unit |
| 21 | `POST /api/team-funnel/copies` | same-origin + client marker；domain `requireTeamFunnelActor` | Zod share code/mode/slug，64 KiB | active vendor membership、team、audience、share availability | claim/copy；duplicate claim 回 200，不重建第二份 | 400／404／409／500 使用穩定 error code | route + policy/domain unit |
| 22 | `POST /api/team-funnel/pages` | same-origin + client marker；domain actor policy | discriminated Zod create/copy，64 KiB | active membership、team、template version ownership | create original page 或 copy template；DB uniqueness 處理 slug/version conflict | 400／404／409／500 使用穩定 error code | route + tenant negative unit |
| 23 | `POST /api/team-funnel/partner-profile` | same-origin + client marker；domain actor policy | Zod get/team/page，64 KiB | actor 只能讀所屬 team/page | 只讀 | 400／404／409／500 使用穩定 error code | route + policy unit |
| 24 | `POST /api/team-funnel/product-slots` | same-origin + client marker；domain actor policy | discriminated Zod set-default/set-override/resolve，64 KiB；URL 2,000 chars | team、template/page、product 皆為 vendor composite relation | create/upsert/resolve；upsert key 保證同 page/slot 單筆 override | 400／404／409／500 使用穩定 error code | route + tenant/product URL unit |
| 25 | `POST /api/team-funnel/shares` | same-origin + client marker；domain actor policy | Zod create/disable，64 KiB；maxUses bounded | content owner／direct-downline／member audience policy | create/disable share；衝突回 409 | 400／404／409／500 使用穩定 error code | route + audience policy unit |
| 26 | `POST /api/team-funnel/templates` | same-origin + client marker；domain actor policy | Zod publish payload，64 KiB；content/locks bounded | template、team、content owner membership | publish immutable next version；DB unique template/version 抗 concurrent duplicate | 400／404／409／500 使用穩定 error code | route + ownership/version unit |
| 27 | `POST /api/webhooks/payments` | configured provider + raw-body signature | raw body 64 KiB；adapter normalization + `PaymentWebhookPayload` | vendor 由 verified payload 或既有 provider order 解析；scoped lookup 必須同 vendor/provider/order；amount/currency/status invariant | `WebhookEvent(provider,eventId)` DB unique；processed replay 直接成功；ledger 於 SERIALIZABLE transaction 處理 | 400／401／403／413／500 使用安全 error code；成功回 provider ack | route fixture + isolated PostgreSQL logical-order/refund/concurrency/provider-scope regression |

## 已確認的 contract 缺口

| ID | 範圍 | 缺口 | 風險 | 下一個可重現證據 |
|---|---|---|---|---|
| API-C01 | Checkout | caller 沒有 idempotency key；使用者重送會建立新 order/reservation | provider 前重送可能形成多筆 pending transaction | 定義 idempotency token semantics；加入 concurrent duplicate checkout DB test |
| API-C02 | Public analytics／affiliate click | append-only endpoint 沒有 authenticity proof 或 replay key | 指標可被 same-origin automation 灌水 | 依 D-001／D-002 決策加入 signed event/referral proof |
| API-C03 | Cloudflare direct upload/live input | 每次受權呼叫都可能建立新 provider resource | job retry 可能重複建立 provider resource | provider 支援的 idempotency key 或本地 operation ledger |
| API-C04 | Test Email／Sentry／PostHog | 每次呼叫都會建立外部事件 | ops retry 會重複通知 | 僅保留受控人工 smoke；若要自動化，加入 explicit run token |
| API-C05 | Error contract | 多數 public routes 使用穩定字串，Team Funnel 使用結構化 code，尚未有 machine-readable manifest | client 對錯誤格式的假設可能漂移 | 將本 registry 對應成 executable contract cases |

## 驗收判定

- Static inventory：27/27 route handlers 已登錄。
- Same-path test：27/27。
- Runtime input validation：所有 JSON/form write route 已使用 Zod 或明確 bounded raw-body parser。
- Auth／tenant：與 `AUTHORIZATION_MATRIX.md` 一致。
- 完成度：registry 已建立；API-C01～C05 尚未關閉，因此 Q08 不能標為 100。
