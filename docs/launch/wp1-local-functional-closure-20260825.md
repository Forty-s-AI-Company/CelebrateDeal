# WP1 Local Functional Closure — 2026-08-25

## 結論

WP1 本機功能閉環已完成；本文件只證明 synthetic loopback／disposable PostgreSQL 的產品與測試結果，不代表 staging、外部 provider、PayUni Sandbox 或 Production 已完成。

- `ENGINEERING_READY=true`
- `PAYMENT_RECONCILIATION_READY=false`
- `SANDBOX_READY=false`
- `PRODUCTION_READY=false`
- `releaseDecision=NO_GO`

## 已完成

| 項目 | 狀態 | 去敏 evidence |
|---|---|---|
| 商品 create／edit transport | `PASS_LOCAL` | 同源 `POST /api/products/upsert`；Server Action 保留 progressive fallback；成功 303，失敗只回 allowlisted enum |
| 商品 redirect flake | `PASS_LOCAL` | `g7-48a-product-delivery-browser-qa-525a1de1b01f9bbc.json`：10/10、0 failed、0 skipped |
| Commerce 完整閉環 | `PASS_LOCAL` | `g7-04-browser-qa-4f223139252eae35.json`：17/17、0 failed、0 skipped |
| 全專案 Browser | `PASS_LOCAL` | Playwright 139/139、`--fail-on-flaky-tests`、0 retry／flaky |
| Combined coverage | `PASS_LOCAL` | Vitest 3117/3117＋Node TAP 844/844、0 failed、0 skipped；64.89% statements、64.49% branches、71.09% functions、69.80% lines |
| Buyer paid callback | `PASS_LOCAL` | pending order → trusted demo paid callback → paid order／inventory commit／entitlement／delivery；duplicate callback 無重複副作用 |
| Buyer paid Email queue | `PASS_LOCAL` | server-owned `order_paid` encrypted EmailDelivery；duplicate callback 維持一筆 queued snapshot |
| SaaS plan checkout | `PASS_LOCAL` | owner 選方案 → pending subscription／transaction → trusted paid callback → active subscription／usage limit |
| SaaS failure／refund／invoice | `PASS_LOCAL` | failed callback 不啟用方案；退款更新 subscription；invoice paid lifecycle 通過 |
| Disposable live-chat DB contract | `PASS_LOCAL` | 1/1、0 skipped；loopback allowlist＋explicit disposable flag；container cleanup PASS |
| CI flaky policy | `PASS_LOCAL_CONFIG` | release browser gate 使用 `--fail-on-flaky-tests` |

## 安全與資料邊界

- Product route 保留 CSRF、Origin、session、active manager role、tenant、revision、delivery encryption 與 transaction 規則。
- HTTP error 不回傳 delivery plaintext、資料庫 row、credential 或 exception detail。
- `order_paid` Email payload 由訂單加密 envelope 在伺服器端解密後重新加密；receipt 與 callback metadata 不含買家 PII。
- Demo payment 只在明確 loopback E2E runtime 可建立 local-only checkout；Production demo webhook 仍被拒絕。
- 本輪未讀取 `.env*`，未操作 staging、外部 provider、PayUni Sandbox 或 Production。

## 尚未證明

| 項目 | 狀態 | 下一步 |
|---|---|---|
| Exact RC remote CI | `NOT_PROVEN` | 建立 local checkpoint，取得 push 授權後由 GitHub Actions 驗證 |
| Actual staging lineage／migration／backup／restore／rollback | `NOT_PROVEN` | WP2，需 bounded staging-only 授權 |
| Cloudflare／Resend／Sentry／PostHog／durable rate limit | `PENDING_EXTERNAL` | WP3，需 staging source lineage 與 provider 授權 |
| PayUni 三種 Sandbox reconciliation | `PENDING_EXTERNAL` | WP4，需 Sandbox 授權；禁止重跑既有限制項目 |
| Privacy／Terms／Refund／Retention | `PENDING_HUMAN` | WP5 真人 review 與版本／生效日決策 |
| Support／finance／release owner acceptance | `PENDING_HUMAN` | WP5 留下各責任的獨立 acceptance receipt |
| Resend 實際送達 `order_paid` | `PENDING_EXTERNAL` | WP3 只允許受控 staging recipient 驗證 |

在以上必要 evidence 完成前，正式販售維持 fail-closed `NO_GO`。
