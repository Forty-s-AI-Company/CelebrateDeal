# FUNC-2026-08-08-67 商品 URL 錯誤狀態邊界

## 結果

`COMPLETE_LOCAL_FUNCTIONAL_P1_NO_SCORE_CHANGE`

商品建立／編輯 action 現在把圖片 URL 與結帳 URL 一起納入 server-side product input parser。缺少 URL 時仍保存為 `null`；提供但不是安全的 HTTP／HTTPS 完整 URL 時，在資料庫查詢／寫入前 fail closed 導向新增或編輯頁的 `invalid_product` 狀態。ProductForm 的 alert 也明確告知網址格式錯誤，商家可以修正後重新儲存，不會看到未處理的 server exception。

## 實際驗證

- `npx vitest run src/app/actions/product-actions.test.ts`：12/12 PASS。
- 測試涵蓋非法圖片 URL、非法結帳 URL、負／小數價格與庫存、active 零價格、非法幣別、課程 owner 與 CSRF fail-closed；malformed product 不會呼叫 create。
- scoped ESLint：PASS。
- `npx tsc --noEmit`：PASS。
- `cmd.exe /d /c "npm run build"`：PASS；Next.js production build、TypeScript、static page generation 89/89 均完成。
- scoped `git diff --check`：PASS。

## 邊界與下一步

本包只使用本機 deterministic tests 與 production build，未操作 staging、PayUni Sandbox、正式資料庫、付款、退款、寄信或部署。未重試 FIN-08AA、WP-196、WP-197 或其 terminal external command；未降低 coverage threshold、inventory、exclude、skip 或 assertion。

本包不是 CAT 評分驗收，canonical total 如實維持 73.5：CAT04=6.0、CAT10=4.5，`SANDBOX_READY=false`、`PRODUCTION_READY=false`、`current_goal_score_change=0`。下一步仍是另一個能實際完善販售／帳務流程的 P1，並持續補 CAT06 staging matrix、CAT10 真人／監控 evidence 與 QUAL source attribution。
