# QUAL-2026-08-07-27 — Billing plans checkout source attribution

## 判定

`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GLOBAL_GATE_REMAINS_OPEN`

本工作包補強 billing plans／subscription checkout page 的 deterministic source attribution。測試覆蓋 owner 與非 owner 權限、current／changed／checkout query state、pending transaction vendor binding、PayUni allowlisted form／redirect、metadata payload sanitizer、unsafe checkout fallback 與安全錯誤訊息；沒有修改 production source，也沒有執行付款、退款、staging、PayUni 或 Production 流程。

## 實際驗證

- Isolated Vitest：1 file、3 tests，0 failed、0 skipped `PASS`。
- Full Vitest：209 files、1466 tests，0 failed、0 skipped `PASS`。
- Billing plans page source attribution（由本輪 combined coverage 的精確檔案摘要讀回）：statements `93.10%`、branches `92.64%`、functions `100%`、lines `96.42%`。
- Node contracts：679/679，0 failed、0 skipped `PASS`。
- `npm run typecheck` `PASS`。
- `npm run lint`：0 errors、2 個既有 warning，命令 exit `0`。
- `npm run secret:scan`：`secret_scan_passed`。
- `git diff --check`：exit `0`。

## Global gate 與分數邊界

本包在新增 billing plans source attribution test inventory 後重跑 `npm run test:coverage`，實際 exit `1`，保留為失敗而非 PASS：

- Combined Vitest：209 files／1466 tests，0 failed、0 skipped。
- Node contracts：679/679，0 failed、0 skipped。
- Combined global coverage：statements `42.00%`、branches `47.68%`、functions `50.74%`、lines `61.19%`。
- Threshold 仍為 `63/57/60/65`；結果 `FAIL_REMAINING_SOURCE_INVENTORY`。
- 相較 QUAL-2026-08-07-26：`+0.04／+0.15／+0.10／+0.06` 個百分點。
- 沒有修改 threshold、inventory、exclude、skip 或 assertion。

`node scripts/readiness-truth-reconciliation.mjs` 回傳 status `PASS`、10 categories、total `73.5`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。billing plans local page attribution 不能替代 CAT04 所需 staging／PayUni provider receipt，也不能替代 CAT10 所需真人 merchant、客服／財務、法務／隱私／退款、external monitoring 與 release owner sign-off，因此 canonical score 沒有增加。

## 安全與回滾

- 沒有讀取或保存 `.env*`、credential、Token、Cookie、正式 Secret、正式客戶資料或付款資料；fixture 與測試資料均為 synthetic。
- 沒有執行 staging、PayUni、Production、付款／退款、deployment、push 或 merge；沒有重試 FIN-08AA、WP-196、WP-197。
- 若需回滾，僅移除本 WP27 owned isolated test 與本 evidence/report/index/state/log 變更；不要使用 reset、clean、stash、restore 或 checkout。
