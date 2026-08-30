# REL-20260821 staging migration source lineage binding

日期：2026-08-21（Asia/Taipei）  
Source RC：`318cd48`  
結果：`PASS_LOCAL_ONLY`

## 完成內容

`scripts/staging-migration-evidence.mjs` 的 receipt schema 已由 v1 提升為 v2，新增必要的 `sourceCommit` 欄位。`PASS` receipt 必須帶有 7 至 40 位、小寫 hexadecimal source commit；缺少或格式不合法時，結果會維持 `BLOCKED`，source lineage 會記為 `unknown`。舊 v1 receipt 會被拒絕，避免實際 staging migration 尚未綁定 current RC 時被誤認為可接受證據。

## 本機驗證

- `npx vitest run scripts/staging-migration-evidence.test.mjs`：`7/7` passed。
- `node --test scripts/validate-staging-migration-evidence.test.mjs`：`9/9` passed。
- staging migration schema、validator 與 current handoff assertion 的 scoped ESLint：`PASS`。
- Node contract suite：`822/822` passed、`0` skipped。
- combined coverage：`404` files passed、`1` skipped；`3090` passed、`1` skipped；statements／branches／functions／lines=`64.65／64.34／70.91／69.55`，高於 `63／57／60／65` 門檻。
- controlled production build：`PASS`。
- current release evidence bundle validation：`PASS; result=INCOMPLETE`，13 個 gate 的 source lineage 均為 `318cd48`。

## 邊界與未完成事項

這是 local contract 與 evidence aggregation 的驗證，沒有執行 staging migration、database write、backup、restore、rollback、Cloudflare、Resend、Sentry、PostHog、durable rate limit、PayUni、Production 或正式付款／退款／寄信。actual staging migration status 仍為 `NOT_PROVEN`；`PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`、`releaseDecision=NO_GO` 維持不變。

本次未讀取或保存 `.env*` 內容、密碼、Token、Cookie、正式 Secret、客戶資料或付款資料，也沒有 push、workflow dispatch 或 deployment side effect。
