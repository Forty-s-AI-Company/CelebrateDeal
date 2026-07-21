# CelebrateDeal Release Readiness Audit

日期：2026-07-21

範圍：PayUni Sandbox 外部阻擋以外的 P0／P1 上線必要項目

模式：人工主導；AI Team、Supervisor、Watchdog、revive timer 全程停用

## 結論

- 目前沒有已知的本機程式碼 P0。
- Lint、TypeScript、704 個單元／整合測試與 Production Build 通過。
- Playwright smoke 以乾淨 Git revision 連續兩次 25/25 通過。
- 可以進入 Staging 部署驗證；但 Vercel Preview 環境隔離、受控 Email smoke、Sentry client 監控、Cloudflare key 輪替／真實 webhook、備份還原演練仍須在 Staging 完成。
- 真正販售前仍有一個程式碼 P1：商品庫存目前只在 checkout 前檢查，付款成功後缺少具冪等性與併發保證的庫存異動帳。
- PayUni Sandbox `QUERY03001` 保持外部阻擋，本輪未重跑、未修改 Production 狀態。

## 本輪已修正

| 項目 | 結果 | Git checkpoint |
|---|---|---|
| JSON、webhook 與 CSP report body 固定記憶體上限 | 超量內容在驗簽／DB 前回 413 | `b23089f`、`41323b0` |
| Durable rate limit 外部請求逾時 | Upstash 3 秒逾時並 fail-closed 回 503 | `1cfc603` |
| Origin／CSRF proxy header 信任 | 不再讓 `X-Forwarded-Host` 擴張 allowlist | `d16db98` |
| 平台停權與商家成員重啟用隔離 | 商家 owner 不可解除平台層停權 | `658a26b` |
| 商家 owner 併發停用 | Serializable 交易保證至少一位有效 owner | `66d2eb8` |
| Vendor／Finance／Platform 權限邊界 | 平台後台、商家寫入與財務權限分離 | `117d7c9` |
| 帳單與出款 CSV | 租戶隔離、公式注入防護、no-store 與下載 audit | `21b6064`、`19d4f34` |
| 密碼重設寄信失敗 | 未送達 token 立即撤銷並留下安全 audit | `e493ba3`、`bfee820` |
| Email smoke | 只能寄單一受控收件人 | `bcfb493` |
| Cloudflare 錯誤與 secret | 固定逾時、封閉診斷、Live stream key AES-256-GCM 加密落庫 | `eb0463f`、`1ba61cc` |
| 部署 preflight | Preview／Production 缺 CSRF、durable rate limit 或 HTTPS 時 build fail-closed | `942f1a0`、`a2ab5b9` |
| Next browser security | HSTS；關閉未使用的任意遠端 Image Optimizer 代理面 | `50cbc42` |
| E2E 穩定與測試隔離 | Run-scoped fixture、受控 mail env、cold Server Action timeout、測試產物不污染 lint | `5cc1b4f`、`cb8cf53`、`9b44951` |

## 安全／一致性發現

### RRA-001 — High — 尚未修正：庫存缺少 paid-once ledger

- 位置：`src/app/api/payments/checkout/route.ts:57`、`src/lib/payment-webhooks.ts:269`
- 證據：checkout 只確認 `inventory > 0`；paid webhook 會更新交易與歸因，但沒有具唯一鍵或狀態 CAS 的庫存扣減紀錄。
- 影響：同時結帳可能超賣；若直接在 callback decrement，重送事件又可能重複扣庫存。
- 建議修正：建立 payment-transaction scoped inventory adjustment，使用唯一約束與 Serializable／CAS，明確定義 pending reservation、paid commit、failed/expired release 與退款是否補庫存。
- 暫時緩解：Staging 可測流程但不要視為真實庫存保證；正式販售實體／限量商品前必須完成。

### RRA-002 — High — 已修正：未驗證 raw body 可無上限配置記憶體

- 位置：`src/lib/api-security.ts:138`、`src/app/api/webhooks/payments/route.ts:34`、`src/app/api/cloudflare/stream-webhook/route.ts:23`
- 修正：共用 bounded stream reader；超量或讀取失敗不回傳部分內容，也不進入驗簽、audit 或 DB。

### RRA-003 — High — 已修正：最後 owner 併發 write-skew

- 位置：`src/app/actions.ts:935`
- 修正：owner count 與條件式停用位於同一 Serializable 交易；序列化衝突保守拒絕。

### RRA-004 — High — 已修正：未送達的 reset token 保持有效

- 位置：`src/lib/password-reset.ts:78`
- 修正：Resend 失敗立即撤銷該 token，audit 不保存 provider 原始錯誤。

### RRA-005 — High — 已修正：Cloudflare stream key 明文落庫

- 位置：`src/lib/sensitive-data.ts:17`、`src/lib/cloudflare-ops.ts:111`
- 修正：新建／更新 key 使用 purpose-separated AES-256-GCM envelope；缺少 server encryption key 時 fail-closed。
- 既有資料：舊 Staging Live Input 必須旋轉，不應假設歷史明文已自動轉換。

### RRA-006 — Medium — 已修正：部署設定與 HTTP transport 可晚到 runtime 才失敗

- 位置：`src/lib/env.ts:6`、`next.config.ts:34`
- 修正：驗證 Email sender、阻擋 header injection、部署 URL 必須 HTTPS、加入 HSTS，且 `npm run build` 執行 preflight。

## 分類清單

### 現在可以自動修正

- RRA-001：付款成功只扣一次的庫存調整／reservation ledger。
- CSP 從 Report-Only 收斂到 enforce 前的 nonce／第三方來源整理；需先取得 Staging violation 樣本，避免猜測破壞登入或分析工具。

### Staging 部署後才能驗證

- Vercel Preview 必須使用獨立 Supabase Staging `DATABASE_URL`／`DIRECT_URL`，不可沿用 Production。
- 補齊 Preview 的 `CSRF_SECRET` 與明確 `RATE_LIMIT_PROVIDER`，以 `/api/admin/preflight` 驗證。
- 驗證 Vercel Preview URL 與正式自訂 Staging 網域皆無法繞過 Cloudflare WAF；若可繞過，改用 Upstash 或限制 Preview 存取。
- 設定單一受控 `SMOKE_TEST_EMAIL`，驗證成功寄信會留下有效 token、失敗寄信會撤銷 token，且不寄非測試收件人。
- 補 `NEXT_PUBLIC_SENTRY_DSN`，驗證 client global error、server synthetic error、source map 與 alert rule。
- 旋轉／重建既有 Cloudflare Live Input，確認新 stream key 是加密 envelope；再做 signed webhook、逾時與錯誤狀態驗收。
- 觀察 CSP report-only violation，整理後再決定 enforce 日期。
- 以 Supabase staging／restore project 完成一次 backup restore drill。

### Production 必須人工驗收

- 正式網域、TLS、HSTS、DNS 與 Vercel Production env scope。
- 第一個 platform admin MFA enrollment、recovery code 保存與遺失裝置 SOP。
- Resend 寄件網域 SPF／DKIM／DMARC 與正式寄件人核准。
- Cloudflare Production scoped token、Webhook Signature、Live Input／upload 權限與 key rotation。
- Sentry Production alert、PostHog funnel、Supabase backup policy 與 rollback runbook 演練。
- PayUni 正式商店核准後的 Production 付款／退款／對帳；必須由人工作最終核准。

### PayUni 外部阻擋（本輪不處理）

- Sandbox UPP 可開啟，但供應商未建立可查詢交易。
- Trade Query 回 `QUERY03001`。
- 需由 PayUni Dashboard／商店權限／測試卡資格或客服端確認；不得以偽造 callback 或放寬未知狀態處理。

## 驗證證據

| 檢查 | 結果 |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test` | PASS — 90 files / 704 tests |
| `npm run build` | PASS — 72 routes/pages generated |
| `npm run e2e:smoke` 第一次 | PASS — 25/25 |
| `npm run e2e:smoke` 第二次 | PASS — 25/25 |
| `npm audit --omit=dev --audit-level=high` | PASS — 0 vulnerabilities |
| PayUni／Cloudflare external QA | 未執行（依本輪規則） |

## 上線販售成熟度（10 分制）

| 項目 | 分數 | 說明 |
|---|---:|---|
| Build／測試基礎 | 9.4 | 704 tests、build、E2E 連續兩輪通過 |
| 身分驗證／MFA | 9.0 | 流程完整；Production enrollment／recovery SOP 待人工演練 |
| 權限／租戶隔離 | 9.2 | 平台、商家、財務邊界與主要 relation 均有回歸測試 |
| 帳務／訂閱／帳單 | 8.5 | 方案、帳單、CSV、出款一致性已強化；庫存 ledger 尚缺 |
| PayUni 付款閉環 | 6.5 | 程式碼 fail-closed；Sandbox 仍被供應商外部狀態阻擋 |
| Email | 8.2 | 失敗補償與受控 smoke 完成；Staging 寄送與 DNS 待驗收 |
| Cloudflare Stream | 8.1 | 驗簽、逾時、租戶映射與 key 加密完成；真實 Staging 驗收待做 |
| Web／API 資安 | 8.9 | body limits、CSRF、headers、rate limit gate 完成；CSP 尚 report-only |
| 監控／營運 | 7.6 | Health、Sentry server、runbook 已有；client DSN、alerts、restore drill 待外部驗收 |
| Staging 部署準備 | 8.0 | 本機 release gate 全綠；Preview env scope 仍需人工補齊 |

整體程式碼成熟度：約 **8.7/10**。

包含外部服務與正式營運驗收的實際可販售成熟度：約 **7.8/10**。

## 下一個最值得處理的任務

實作「付款交易 scoped、可重送且具併發保證的庫存 reservation／adjustment ledger」。這是 PayUni 以外，對實際販售風險影響最大的剩餘 P1；完成後再部署 Staging 做 Email、Cloudflare、Sentry、CSP 與 backup restore 驗收。
