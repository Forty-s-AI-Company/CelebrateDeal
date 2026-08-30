# QUAL-11 — Product action deterministic source attribution

日期：2026-08-07  
結果：`COMPLETE_LOCAL_DETERMINISTIC_TESTS`；coverage global gate 仍未達標。

## 修正與覆蓋範圍

- 新增 `src/app/actions/product-actions.test.ts`，只使用 Vitest mocks，不連接外部服務或正式資料。
- 覆蓋 merchant product create／normalization、course owner／promoter-share validation、course policy version increment、unsafe external URL rejection 與 CSRF fail-closed。
- 沒有降低 assertion、threshold、inventory、exclude 或 skip，也沒有改變既有 production 行為。

## 可追溯驗收結果

- targeted：1 file，6 passed，0 failed，0 skipped。
- full Vitest：175 files，1278 passed，0 failed，0 skipped。
- Node contracts：620/620 passed。
- TypeScript：PASS；full ESLint：0 errors，2 個既有 warnings。
- combined coverage：global statements／branches／functions／lines 為 38.75／44.73／47.06／59.03，低於既有 63／57／60／65，標示 `FAIL_REMAINING_SOURCE_INVENTORY`。
- scripts attribution：27.15／35.48／33.23／46.52；src attribution：82.47／75.51／82.64／85.00。
- 相較 FIN-14，global 四項提升 0.13／0.19／0.11／0.21 個百分點；仍不代表 coverage gate 通過。

## 邊界與評分

本包沒有執行 staging、PayUni Sandbox、Production、正式付款／退款或寄信，也沒有讀取 `.env*`、Token、Cookie 或 Secret。CAT04 維持 6.0、CAT06 7.0、CAT10 4.5、總分 73.5；CAT06 staging blocker、CAT10 真人法律／客服／monitoring／release owner evidence 與外部 provider evidence 仍 pending。FIN-08AA、WP-196、WP-197 均未重試。

證據檔：`.ai-team/reports/qual11-product-action-source-attribution.json`。
