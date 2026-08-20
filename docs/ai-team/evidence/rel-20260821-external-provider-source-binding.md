# REL-20260821 external provider source lineage binding

日期：2026-08-21（Asia/Taipei）  
Source RC：`5607910`  
結果：`PASS_LOCAL_ONLY`

## 完成內容

`scripts/external-provider-evidence.mjs` 的 receipt schema 已由 v1 提升為 v2，新增 `sourceCommit` lineage 欄位。`PASS` receipt 必須帶有 7 至 40 位、小寫 hexadecimal source commit；缺少、格式不合法或仍使用 `unknown` 時，結果會維持 fail closed。`PENDING_EXTERNAL` receipt 可以保留 `unknown`，但不能被誤認為已完成的 provider evidence。舊 v1 receipt 會被拒絕，避免外部服務證據脫離 current RC source。

## 本機驗證

- `node --test scripts/external-provider-evidence.test.mjs`：`13/13` passed。
- `node --test scripts/validate-external-provider-evidence.test.mjs`：`8/8` passed。
- external provider evidence schema、validator 與測試的 scoped ESLint：`PASS`。
- Node contract suite：`823/823` passed、`0` skipped。
- combined coverage：`404` files passed、`1` skipped；`3090` passed、`1` skipped；statements／branches／functions／lines=`64.60／64.33／70.68／69.53`，高於 `63／57／60／65` 門檻。
- `npm run lint`、TypeScript、strict index、secret scan、`npm audit --omit=dev --audit-level=high` 與 controlled production build：`PASS`。
- current release evidence bundle：13 個 gate 均已改綁 source `5607910`；validator 結果維持 `PASS; result=INCOMPLETE`，release decision 維持 `NO_GO`。

## 邊界與未完成事項

這是 local contract 與 evidence aggregation 的驗證，沒有呼叫 Cloudflare、Resend、Sentry、PostHog、durable rate limit、PayUni、staging 或 Production，也沒有寄信、付款、退款、部署或 workflow dispatch side effect。五個 external provider gate 與 PayUni Sandbox reconciliation 仍為 `PENDING_EXTERNAL`；actual staging lineage、migration、recovery、rollback、remote CI、政策 review 與真人 acceptance 仍未完成。`PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`、`releaseDecision=NO_GO` 維持不變。

本次未讀取或保存 `.env*` 內容、密碼、Token、Cookie、正式 Secret、客戶資料或付款資料。既有舊 v1 historical receipt 保留原狀，不能作為 current v2 `PASS` evidence。
