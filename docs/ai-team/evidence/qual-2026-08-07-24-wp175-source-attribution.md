# QUAL-2026-08-07-24 — WP175 source attribution and global coverage recomputation

## 判定

`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GLOBAL_GATE_REMAINS_OPEN`

本工作包為 WP175 sales-to-support operational rehearsal 新增未被既有 Vitest exclude 清單排除的 isolated TypeScript source-attribution suite。測試只讀取 synthetic contract／fixture 與受保護 source digest，沒有修改 WP175 production runner，也沒有執行 `run()` 的 receipt writer。

## 實際驗證

- 原有 `scripts/wp175-sales-to-support-operational-rehearsal.test.mjs` selector 曾因既有 Vitest exclude 清單回傳 `No test files found`；此結果記錄為 test-discovery boundary，沒有標成 PASS，也沒有重試同一 selector。
- 新增 `scripts/wp175-sales-to-support-operational-source-attribution.test.ts` 後，targeted Vitest：1 file、6 tests，0 failed、0 skipped `PASS`。
- WP175 source targeted V8：statements `86.51%`、branches `86.36%`、functions `93.33%`、lines `85.29%`；CLI main／receipt writer 維持未執行，沒有為提高 coverage 產生檔案寫入副作用。
- Full Vitest：205 files、1451 tests，0 failed、0 skipped `PASS`。
- Node contracts：679/679，0 failed、0 skipped `PASS`。
- `npm run typecheck` `PASS`。
- Scoped ESLint（WP175 isolated test 與 stream usage tests）0 errors `PASS`。
- `npm run secret:scan` `secret_scan_passed`。
- `git diff --check` exit `0`；LF/CRLF 訊息是既有工作樹提示，不是 diff error。

## Global gate

本包在 source inventory 實質變更後重新執行 `npm run test:coverage`，實際 exit `1`，不得標成 PASS：

- Vitest：205 files／1451 passed／0 failed／0 skipped。
- Node contracts：679/679 passed／0 failed／0 skipped。
- Combined global coverage：statements `41.44%`、branches `46.96%`、functions `50.23%`、lines `61.07%`。
- Unchanged threshold：statements／branches／functions／lines `63%／57%／60%／65%`。
- 相較 QUAL-19：`+0.71／+0.40／+0.98／-0.09` 個百分點；lines 下降是新增 script inventory 後分母擴大，不是 assertion 或 gate 被放寬。
- Result：`FAIL_REMAINING_SOURCE_INVENTORY`。沒有修改 threshold、inventory、exclude、skip 或 assertion。

## 分數與安全邊界

- `node scripts/readiness-truth-reconciliation.mjs`：status `PASS`、10 categories、total `73.5`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。
- canonical CAT01 `7.5`、CAT04 `6.0`、CAT10 `4.5`；本工作包 `current_goal_score_change=0`。
- global coverage 改善不替代 CAT04 fresh staging／PayUni provider receipt，也不替代 CAT10 真人 merchant／客服／法務／財務／release owner 與 external monitoring acceptance。
- 沒有讀取或保存 `.env*`、credential、Token、Cookie、正式 Secret、正式客戶資料或付款資料；沒有 staging、PayUni、Production、付款／退款、deployment、push、merge 或 terminal retry。
- 若需回滾，僅移除本 WP24 owned isolated test 與本 evidence/report；不要使用 reset、clean、stash、restore 或 checkout。
