# FUNC-2026-08-08-79 — Quota-backed Live share payment gate

## 結果

`COMPLETE_LOCAL_FUNCTIONAL_P1_NO_SCORE_CHANGE`

補上 team Live share domain service 的付款人驗證：重新建立或啟用 quota-backed Live
share 前，會重新讀取來源 Live 的 quota policy，並檢查 VENDOR／MEMBER 對應的 verified、
未過期 payment method reference。缺少 reference 時以 bounded conflict fail closed，
不會執行 `partnerLiveShare.upsert`。

這修正了「Live 建立時有付款方式 gate，但後續 share API 可繞過該前置條件」的可販售
功能缺口。沒有把本機 gate 當成 provider recurring charge、PayUni Sandbox 或真人
owner acceptance。

## 驗證

- focus：team Live sharing／action／API／commercial flow 4 files、27/27 PASS、0 failed、0 skipped。
- expanded team-funnel regression：8 files、65/65 PASS、0 failed、0 skipped。
- scoped ESLint：PASS。
- TypeScript：PASS。
- `npm.cmd run build`：PASS；Next production compile、post-compile、TypeScript 與 static pages `89/89` PASS。
- `git -c core.autocrlf=false diff --check`：PASS。

## 邊界與安全

- 沒有 schema／migration、staging、PayUni Sandbox、Production、正式資料庫、正式付款、退款、寄信或 deployment。
- 沒有讀取或輸出 `.env*` 內容、credential、Token、Cookie、正式 Secret、正式客戶資料或付款資料。
- 沒有重試 FIN-08AA、WP-196、WP-197，也沒有重試同一個 terminal endpoint/probe/failure command。
- 沒有降低 coverage threshold、source inventory、exclude、skip 或 assertion；本輪沒有重跑 global coverage。
- canonical score 如實維持 `73.5`：CAT04 `6.0`、CAT10 `4.5`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`、`current_goal_score_change=0`。

## 下一步

繼續處理剩餘可販售的財務／營運產品缺口；CAT04 外部 Sandbox／staging reconciliation 與 CAT10 真人 owner、政策及 monitoring acceptance 仍須分開取得，不能由本機測試取代。
