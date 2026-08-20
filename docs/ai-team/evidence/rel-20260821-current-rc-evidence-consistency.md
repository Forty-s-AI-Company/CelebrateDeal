# REL-20260821 Current release evidence consistency guard

日期：2026-08-21（Asia/Taipei）  
Source RC：`8a043b4`  
工作包：`REL-20260821-CURRENT-RC-EVIDENCE-CONSISTENCY`

## 目的

讓 current release handoff、completion audit 與 machine-readable release bundle 指向同一個 current source checkpoint，並鎖定本次實際 coverage 摘要，避免舊 evidence count 回流到 release 文件。

## 修正結果

- current release completion audit 與 gate handoff 的 Source RC 更新為 `8a043b4`。
- current release evidence bundle 的 root 與 13 個 gate source lineage 全部更新為 `8a043b4`；結果仍為 `INCOMPLETE`、`releaseDecision=NO_GO`、`productionApproval=false`。
- handoff contract 新增 current source 與 coverage 摘要 assertion，拒絕舊的 `3086 passed／1 skipped`。
- `.github/workflows/ci.yml` 新增 `Current release handoff evidence consistency` gate，讓 CI 直接執行同一份 current handoff contract。
- evidence index 新增本工作包的 machine-readable bundle lineage 與驗證結果索引。

## 驗證

- current release handoff contract：`1/1`。
- CI gate command：`node --test scripts/current-release-gate-handoff.test.mjs`，`1/1`。
- Node TAP contracts：`822/822`，0 failed、0 skipped。
- combined coverage：`404 files passed／1 skipped`、`3088 passed／1 skipped`；statements／branches／functions／lines=`64.65／64.34／70.91／69.54`。
- `npm run lint`：0 errors、0 warnings。
- `npm run typecheck`：PASS。
- `npm run typecheck:strict-index`：PASS。
- `npm run secret:scan`：`secret_scan_passed`。
- `node scripts/validate-release-evidence-bundle.mjs docs/ai-team/evidence/release-evidence-bundle-current-status-20260821.json`：`PASS; result=INCOMPLETE`。
- `node scripts/readiness-truth-reconciliation.mjs`：`PASS`，canonical total `75.5`。
- `git diff --check`：PASS。

## 邊界與放行狀態

本工作包只修改 local release evidence lineage、文件與 contract assertion。沒有呼叫 Cloudflare、Resend、Sentry、PostHog、durable rate limit、PayUni、staging 或 Production，也沒有付款、退款、寄信、部署或 workflow dispatch。

目前仍維持：

```text
ENGINEERING_READY=true
PAYMENT_RECONCILIATION_READY=false
SANDBOX_READY=false
PRODUCTION_READY=false
releaseDecision=NO_GO
```

外部 provider、actual staging、PayUni Sandbox reconciliation、policy 與 human acceptance 仍需受控 owner evidence；本地 contract 通過不會升格為 release readiness。
