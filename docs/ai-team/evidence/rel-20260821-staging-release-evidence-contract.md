# REL-20260821 staging release evidence aggregation contract

日期：2026-08-21（Asia/Taipei）  
Source RC：`c7fa06a`  
結果：`PASS_LOCAL_ONLY`

## 完成內容

新增 `scripts/staging-release-evidence.mjs` 與 read-only `scripts/validate-staging-release-evidence.mjs`。aggregate receipt schema 要求 `lineage`、`migration`、`recovery`、`rollback` 四個 component 使用同一個 current RC `sourceCommit`，並保留各自的 opaque evidence reference。缺少 authorization、source lineage、non-Production identity 或任一 component 時，結果維持 `BLOCKED`；component 明確失敗時保留 `FAILED`。`PASS` 需要四個 component 全部通過、source lineage 完全一致、`environmentClass=staging`、`nonProduction=true` 與 `productionOperations=0`。

CLI 只讀 `docs/ai-team/evidence` 與 `.ai-team/reports` 下的 sanitized receipt，拒絕 traversal、symlink escape、敏感檔名、raw artifact、URL、credential-like text 與未知 schema。它不執行 staging command、不開資料庫連線、不呼叫 provider，也不寫入 evidence。

## 本機驗證

- `node --test scripts/staging-release-evidence.test.mjs`：`9/9` passed。
- `node --test scripts/validate-staging-release-evidence.test.mjs`：`9/9` passed。
- staging aggregate 與 receipt validator 合併：`18/18` passed。
- Node contract suite：`841/841` passed、`0` skipped。
- combined coverage：`404` files passed、`1` skipped；`3090` passed、`1` skipped；statements／branches／functions／lines=`64.75／64.49／71.04／69.65`，高於 `63／57／60／65` 門檻。
- `npm run lint`、TypeScript、strict index、secret scan、`npm audit --omit=dev --audit-level=high` 與 controlled production build：`PASS`。
- `.github/workflows/ci.yml` 已加入 aggregate contract 與 receipt validation contract steps。

## 邊界與未完成事項

這是 local／synthetic evidence contract，不是 actual staging receipt。尚未執行 staging deployment、migration、backup、restore、rollback／forward 或 remote CI；current bundle 的 staging lineage、migration、recovery、rollback gates 仍為 `NOT_PROVEN`。Cloudflare、Resend、Sentry、PostHog、durable rate limit、PayUni Sandbox reconciliation、政策 review 與真人 acceptance 也仍未完成。`PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`、`releaseDecision=NO_GO` 維持不變。

本次未讀取或保存 `.env*` 內容、密碼、Token、Cookie、正式 Secret、客戶資料或付款資料；沒有 staging、外部 provider、PayUni、Production、付款、退款、寄信或 deployment side effect。
