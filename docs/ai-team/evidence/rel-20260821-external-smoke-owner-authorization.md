# REL-20260821 External smoke owner authorization gate

日期：2026-08-21（Asia/Taipei）  
Source RC：`7a9c996`  
工作包：`REL-20260821-EXTERNAL-SMOKE-OWNER-AUTHORIZATION`

## 目的

補上通用 `scripts/external-smoke.ts` 的 non-Production owner authorization 邊界，避免遠端 Preview／staging smoke 在未授權時先發出 health request，也避免 loopback runner 透過 provider smoke route 意外觸發外部服務。

## 實作結果

- 遠端 target 必須先通過 `scripts/validate-non-production-owner-authorization.mjs`。
- `AI_TEAM_PROVIDER_ENVIRONMENT` 必須與 `SMOKE_ENVIRONMENT` 完全相符。
- 缺少或不相符時，runner 只輸出固定 `blocked_before_network` 分類並停止。
- loopback target 的 health／admin preflight 可做本地診斷；Resend、PostHog、Sentry、Cloudflare、PayUni provider smoke route 在第一個 provider request 前仍需要同一份 authorization。
- 輸出不保存或回傳 authorization reference、Secret、Token、Cookie、URL、provider payload、訂單或付款資料。

## 驗證

- `npx vitest run scripts/external-smoke-safety.test.ts`：`14/14`。
- 測試包含實際 remote missing-authorization child run；固定輸出為 `blocked_before_network`，沒有發出 network request。
- `npm run test:contracts`：`822/822`。
- `npm run lint`：`0 errors、0 warnings`。
- `npm run typecheck`：PASS。
- `npm run typecheck:strict-index`：PASS。
- `npm run secret:scan`：`secret_scan_passed`。
- `git diff --check`：PASS。

## 邊界與目前放行狀態

本工作包沒有呼叫 Cloudflare、Resend、Sentry、PostHog、durable rate limit、PayUni、staging 或 Production，也沒有付款、退款、寄信、部署或 workflow dispatch。這只完成 smoke runner 的本地 fail-closed authorization contract，不代表任何 external provider、PayUni reconciliation、actual staging 或人工 acceptance 已通過。

目前仍維持：

```text
ENGINEERING_READY=true
PAYMENT_RECONCILIATION_READY=false
SANDBOX_READY=false
PRODUCTION_READY=false
releaseDecision=NO_GO
```

下一個外部動作仍需 owner 提供新的 opaque authorization record、可驗證的 non-Production target 與 provider binding，先執行 authorization validator，再依 bounded runbook 收集 sanitized receipt。
