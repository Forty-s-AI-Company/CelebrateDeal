# FUNC-2026-08-08-66 Checkout replay provider boundary

## 結果

`COMPLETE_LOCAL_FUNCTIONAL_P1_NO_SCORE_CHANGE`

修正 `/api/payments/checkout` 的 provider resolution 順序。既有 pending payment transaction 若持有相同 vendor、product、金額、幣別與已保存 checkout session，現在會先完成 idempotency replay；只有確認沒有既有交易時，才解析目前 payment provider 並建立新的 reservation／checkout。這避免 provider 暫時不可用時，重播既有 checkout 被錯誤阻擋，也沒有改變新 checkout 的 provider、inventory 或 metadata fail-closed 邊界。

## 實際驗證

- `npx vitest run src/app/api/payments/checkout/route.test.ts`：25/25 PASS。
- 新增 replay regression：既有 checkout 不會解析 current provider、不會建立第二筆 reservation、不會呼叫 provider checkout session。
- scoped ESLint：PASS。
- `npx tsc --noEmit`：PASS。
- `cmd.exe /d /c "npm run build"`：PASS；Next.js production build、TypeScript、static page generation 89/89 均完成。
- scoped `git diff --check`：PASS。

## 邊界與下一步

本包只使用本機 deterministic route tests 與 production build，未操作 staging、PayUni Sandbox、正式資料庫、付款、退款、寄信或部署。未重試 FIN-08AA、WP-196、WP-197 或其 terminal external command；未降低 coverage threshold、inventory、exclude、skip 或 assertion。

本包不是 CAT 評分驗收，canonical total 如實維持 73.5：CAT04=6.0、CAT10=4.5，`SANDBOX_READY=false`、`PRODUCTION_READY=false`、`current_goal_score_change=0`。下一步仍是另一個能實際完善販售／帳務流程的 P1，並持續補 CAT06 staging matrix、CAT10 真人／監控 evidence 與 QUAL source attribution。
