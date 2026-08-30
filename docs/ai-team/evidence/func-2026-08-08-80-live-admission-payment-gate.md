# FUNC-2026-08-08-80 — Live admission payment-ownership gate

## 結果

`COMPLETE_LOCAL_FUNCTIONAL_P1_NO_SCORE_CHANGE`

將 quota payment ownership 接到公開 Live runtime admission：Live viewer session
建立或續期前，若來源 Live 配置了 member/page/custom quota，系統會在同一個
Serializable transaction 內重新驗證對應的 verified、未過期 payment method reference。
缺少 reference 時回傳 bounded unavailable，且不查詢後續 usage limit、不建立 viewer
session，播放來源因此不會被暴露。

這補上 reference 被撤銷或過期後仍可繼續提供 quota-backed Stream 的實際 P1 缺口；
沒有把本機 runtime gate 當成 recurring charge、PayUni Sandbox 或真人 acceptance。

## 驗證

- focus：admission／API／payment reference 4 files、25/25 PASS、0 failed、0 skipped。
- expanded quota／usage／payment reference／playback regression：9 files、87/87 PASS、0 failed、0 skipped。
- scoped ESLint：PASS。
- TypeScript：PASS。
- `git -c core.autocrlf=false diff --check`：PASS。
- `npm.cmd run build`：PASS；Next production compile、post-compile、TypeScript 與 static pages `89/89` PASS。

## 邊界與安全

- 沒有 schema／migration、staging、PayUni Sandbox、Production、正式資料庫、正式付款、退款、寄信或 deployment。
- 沒有讀取或輸出 `.env*` 內容、credential、Token、Cookie、正式 Secret、正式客戶資料或付款資料。
- 沒有重試 FIN-08AA、WP-196、WP-197，也沒有重試同一個 terminal endpoint/probe/failure command。
- 沒有降低 coverage threshold、source inventory、exclude、skip 或 assertion；本輪沒有重跑 global coverage。
- canonical score 如實維持 `73.5`：CAT04 `6.0`、CAT10 `4.5`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`、`current_goal_score_change=0`。

## 下一步

繼續處理尚未完成的財務／營運功能；CAT04 仍需要新的授權 staging／PayUni Sandbox transaction、provider receipt 與 reconciliation evidence，CAT10 仍需要真人 owner、政策與外部 monitoring acceptance。
