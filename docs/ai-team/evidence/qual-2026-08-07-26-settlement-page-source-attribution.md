# QUAL-2026-08-07-26 — Settlement page source attribution

## 判定

`COMPLETE_TARGETED_SOURCE_ATTRIBUTION_GLOBAL_GATE_REMAINS_OPEN`

本工作包補強平台 finance admin 與商家端 settlement read model 的 deterministic source attribution。測試覆蓋月結狀態、鎖單、待出款、出款批次、人工調整、商家方案 fallback、商家端空狀態與 payout reconciliation 顯示；沒有修改 production source，也沒有執行任何會寫入既有 receipt、staging、PayUni 或 Production 的流程。

## 實際驗證

- Isolated Vitest：2 files、4 tests，0 failed、0 skipped `PASS`。
- Full Vitest：208 files、1463 tests，0 failed、0 skipped `PASS`。
- Settlement source attribution（由本輪 combined coverage 的精確檔案摘要讀回）：
  - `src/app/admin/billing/settlements/page.tsx`：statements `100%`、branches `97.05%`、functions `100%`、lines `100%`。
  - `src/app/(app)/billing/settlements/page.tsx`：statements `100%`、branches `100%`、functions `100%`、lines `100%`。
- Node contracts：679/679，0 failed、0 skipped `PASS`。
- `npm run typecheck` `PASS`。
- `npm run lint`：0 errors、2 個既有 warning，命令 exit `0`。
- `npm run secret:scan`：`secret_scan_passed`。
- `git diff --check`：exit `0`。

## Global gate 與分數邊界

本包在新增 source attribution test inventory 後重跑 `npm run test:coverage`，實際 exit `1`，保留為失敗而非 PASS：

- Combined Vitest：208 files／1463 tests，0 failed、0 skipped。
- Node contracts：679/679，0 failed、0 skipped。
- Combined global coverage：statements `41.96%`、branches `47.53%`、functions `50.64%`、lines `61.13%`。
- Threshold 仍為 `63/57/60/65`；結果 `FAIL_REMAINING_SOURCE_INVENTORY`。
- 相較 QUAL-2026-08-07-25：`+0.05／+0.16／+0.13／+0.06` 個百分點。
- 沒有修改 threshold、inventory、exclude、skip 或 assertion。

`node scripts/readiness-truth-reconciliation.mjs` 回傳 status `PASS`、10 categories、total `73.5`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。CAT04 仍為 `6.0`，需要新的 staging reconciliation 與 PayUni Sandbox/provider receipt；CAT10 仍為 `4.5`，需要真人 merchant、客服／財務 SLA、法務／隱私／退款 review、external monitoring 與 release owner go/no-go／rollback evidence。local UI source attribution 不能替代這些驗收。

## 安全與回滾

- 沒有讀取或保存 `.env*`、credential、Token、Cookie、正式 Secret、正式客戶資料或付款資料；fixture 與測試資料均為 synthetic。
- 沒有執行 staging、PayUni、Production、付款／退款、deployment、push 或 merge；沒有重試 FIN-08AA、WP-196、WP-197。
- 若需回滾，僅移除本 WP26 owned isolated tests 與本 evidence/report/index/state/log 變更；不要使用 reset、clean、stash、restore 或 checkout。
