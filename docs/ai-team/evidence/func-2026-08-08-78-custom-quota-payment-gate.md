# FUNC-2026-08-08-78 — Custom quota payment-method gate closure

## 結果

`COMPLETE_LOCAL_FUNCTIONAL_P1_NO_SCORE_CHANGE`

補上直播 Stream 額度的 server-side payment-method boundary：使用
`MEMBER + CUSTOM` allocation 時，policy parser 現在接受合法的成員分攤設定，
而建立／編輯直播前會以 custom allocation 中的 membership IDs 檢查已驗證且未過期的
payment method reference。缺少付款方式時仍 fail closed，不會建立 Live。

這修正了「畫面宣稱由成員負擔，但 custom allocation 可以繞過付款方式檢查」的可販售
功能缺口；沒有把 provider recurring charge 或外部 Sandbox 驗收誤列為完成。

## 驗證

- `src/app/actions.test.ts` 與 `src/lib/live-quota-policy.test.ts`：2 files、158/158 PASS、0 failed、0 skipped。
- quota／payment-reference／admission／usage／payment-method page regression：9 files、65/65 PASS、0 failed、0 skipped。
- scoped ESLint（actions、policy source/test）：PASS。
- TypeScript：PASS。
- `npm.cmd run build`：PASS；Next production compile、post-compile、TypeScript 與 static pages `89/89` PASS。
- `git -c core.autocrlf=false diff --check`：PASS。

初次未加引號的 PowerShell 多路徑測試命令在 shell parsing 階段因括號路徑被拒絕，沒有啟動 Vitest；改用逐一路徑正確引用的命令後，實際 9 files／65 tests 全部 PASS，未把前一個 shell parsing 結果標成測試 PASS。

## 邊界與安全

- 沒有 schema／migration、staging、PayUni Sandbox、Production、正式資料庫、正式付款、退款、寄信或 deployment。
- 沒有讀取或輸出 `.env*` 內容、credential、Token、Cookie、正式 Secret、正式客戶資料或付款資料。
- 沒有重試 FIN-08AA、WP-196、WP-197，也沒有重試同一個 terminal endpoint/probe/failure command。
- 沒有降低 coverage threshold、source inventory、exclude、skip 或 assertion；本輪沒有重跑 global coverage。
- canonical score 如實維持 `73.5`：CAT04 `6.0`、CAT10 `4.5`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`、`current_goal_score_change=0`。

## 下一步

繼續處理仍未完成的販售／財務產品閉環；CAT04 仍需要新的授權 staging／PayUni Sandbox transaction、provider receipt 與 reconciliation evidence，CAT10 仍需要真人 owner 與外部 monitoring acceptance。
