# REL-20260821：staging read-only health probe

驗證時間：2026-08-21T00:55:51+08:00（Asia/Taipei）  
目標：`https://celebrate-deal-staging.carry-digital-nomad.in.net`  
Scope：只讀 HTTP GET；沒有登入、沒有讀取環境變數或憑證、沒有資料庫／付款／退款／寄信／部署寫入。

## Result

| Probe | Result | Sanitized observation |
|---|---|---|
| `GET /api/health` | `PASS` | HTTP `200`、JSON、`ok=true`、`database=ok` |
| `GET /` | `PASS` | HTTP `200`、HTML public entrypoint |
| `GET /api/admin/preflight` without authentication | `PASS_BOUNDARY` | HTTP `401`，protected admin route 未匿名暴露 |
| `GET /__celebratedeal_wp187_fingerprint.json` | `NOT_PROVEN` | HTTP `200` 但回應不是預期 lineage JSON contract |

安全旗標：`credentialsRead=false`、`mutations=0`、`productionOperations=false`、`rawResponsePersisted=false`。回應內容沒有保存；receipt 只保留固定狀態與安全旗標。

## 判讀

Staging hostname 可連線，公開入口與資料庫 health check 正常，admin preflight 的匿名拒絕邊界存在。這次 probe 沒有證明 current RC `b70539f` 已部署到 staging，因為 WP-187 lineage marker 沒有回傳預期 JSON contract；也沒有證明 staging migration status、backup／restore／rollback、Cloudflare、Resend、Sentry、PostHog、durable rate limit 或 PayUni reconciliation。

因此本證據不調整 `PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`，也不把 staging health 200 解讀為正式販售可行。

## Next safe gate

由具 staging 權限的 owner 重新部署或確認 exact RC lineage 後，才可在明確的 non-Production scope 執行 migration status、backup／restore／rollback 與 provider verification。任何需要憑證、資料庫連線或外部 provider mutation 的步驟仍須另行授權；本輪不執行。
