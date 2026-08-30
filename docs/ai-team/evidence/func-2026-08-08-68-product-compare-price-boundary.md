# FUNC-2026-08-08-68 商品比較價邊界

## 結果

`COMPLETE_LOCAL_FUNCTIONAL_P1_NO_SCORE_CHANGE`

商品建立／編輯的 server-side input parser 現在拒絕低於實際售價的 `compareAtCents`。因此可販售商品不會顯示「原價」低於「售價」的錯誤折扣訊息；既有空白比較價、正整數、大寫幣別、active 價格與 URL fail-closed 規則保留。

## 實際驗證

- `npx vitest run src/app/actions/product-actions.test.ts`：13/13 PASS。
- 新增比較價低於售價的 malformed product regression；不會呼叫 product create。
- scoped ESLint：PASS。
- `npx tsc --noEmit`：PASS。
- `cmd.exe /d /c "npm run build"`：PASS；Next.js production build、TypeScript、static page generation 89/89 均完成。
- scoped `git diff --check`：PASS。

## 邊界與下一步

本包只使用本機 deterministic tests 與 production build，未操作 staging、PayUni Sandbox、正式資料庫、付款、退款、寄信或部署。未重試 FIN-08AA、WP-196、WP-197 或其 terminal external command；未降低 coverage threshold、inventory、exclude、skip 或 assertion。

本包不是 CAT 評分驗收，canonical total 如實維持 73.5：CAT04=6.0、CAT10=4.5，`SANDBOX_READY=false`、`PRODUCTION_READY=false`、`current_goal_score_change=0`。下一步轉向下一個能實際完善販售／帳務流程的 P1，並持續補 CAT06 staging matrix、CAT10 真人／監控 evidence 與 QUAL source attribution。
