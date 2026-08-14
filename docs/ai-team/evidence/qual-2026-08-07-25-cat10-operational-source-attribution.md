# QUAL-2026-08-07-25 — CAT10 onboarding and owner acceptance source attribution

## 判定

`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GLOBAL_GATE_REMAINS_OPEN`

本工作包補強 CAT10 的 WP122 merchant onboarding 與 WP195 launch-owner acceptance contract。新增 isolated Vitest suite，覆蓋 local contract identity、六角色／八階段 onboarding、真人 acceptance pending、五位 owner matrix、evidence／signature／production claim fail-closed 與 receipt score boundary；沒有修改 production runner，也沒有執行會寫入既有 receipt 的 main path。

## 實際驗證

- Targeted Vitest：1 file、8 tests，0 failed、0 skipped `PASS`。
- Targeted V8 attribution：
  - `scripts/wp122-merchant-onboarding-validator.mjs`：statements `80%`、branches `83.14%`、functions `86.66%`、lines `87.01%`。
  - `scripts/wp195-launch-owner-acceptance.mjs`：statements `77.18%`、branches `77.63%`、functions `80.64%`、lines `82.22%`。
  - Combined targeted：statements `78.37%`、branches `79.66%`、functions `82.60%`、lines `84.43%`。
- 首次 targeted assertion 將 baseline 第一個 owner 誤當 finance，實際結果是 merchant；已依 fixture 的真實 owner identity 修正測試定位後重新執行，沒有放寬 assertion，也沒有修改 production source。
- Full Vitest：206 files、1459 tests，0 failed、0 skipped `PASS`。
- Node contracts：679/679，0 failed、0 skipped `PASS`。
- `npm run typecheck` `PASS`；scoped ESLint 0 errors `PASS`；`npm run secret:scan` `secret_scan_passed`；`git diff --check` exit `0`。

## Global gate 與分數邊界

本包在 source inventory 變更後重跑 `npm run test:coverage`，實際 exit `1`，保留為失敗而非 PASS：

- Combined global coverage：statements `41.91%`、branches `47.37%`、functions `50.51%`、lines `61.07%`。
- Threshold 仍為 `63/57/60/65`；結果 `FAIL_REMAINING_SOURCE_INVENTORY`。
- 相較 QUAL-24：`+0.47／+0.41／+0.28／0.00` 個百分點。
- 沒有修改 threshold、inventory、exclude、skip 或 assertion。

`node scripts/readiness-truth-reconciliation.mjs` 仍回傳 status `PASS`、10 categories、total `73.5`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。CAT10 仍為 `4.5`，因 local deterministic contract 不能替代真人 merchant／客服／法務／隱私／退款／財務／release owner acceptance 與 external monitoring。

## 安全與回滾

- 沒有讀取或保存 `.env*`、credential、Token、Cookie、正式 Secret、正式客戶資料或付款資料；所有資料為 synthetic fixture。
- 沒有執行 staging、PayUni、Production、付款／退款、deployment、push 或 merge；沒有重試 FIN-08AA、WP-196、WP-197。
- 若需回滾，僅移除本 WP25 owned isolated test 與本 evidence/report；不要使用 reset、clean、stash、restore 或 checkout。
