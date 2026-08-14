# FUNC-2026-08-08-56｜Finance-scoped webhook reconciliation export

## 結果

`COMPLETE_LOCAL_PRODUCT_FIX_NO_SCORE_CHANGE`。對帳中心原本能在 finance-admin webhook detail page 顯示金額、退款與 referral commission checks，但沒有可保存／交接的差異 artifact。本輪新增 finance-admin scoped sanitized JSON export，讓財務可下載固定 schema 的 reconciliation result。

## 實際產品修正

- 新增 `GET /admin/billing/webhooks/[id]/reconciliation`，先經 `requireFinanceAdmin()`，只接受 bounded event id。
- 匯出內容只包含 schema version、provider／event identity／status、pass／warning／fail summary 與 `reconcileWebhookEvent` checks；不包含 raw payload、normalized payload、credential、HashKey／HashIV 或其他 provider secret。
- webhook detail page 新增「匯出對帳 JSON」入口；原本的 redacted raw／normalized detail 與手動 retry 行為不變。
- 使用 `Cache-Control: no-store` 與固定 `Content-Disposition`，避免對帳 artifact 被快取或使用可注入檔名。

## 驗證結果

- reconciliation export route + webhook detail page：2 test files、4/4 PASS，0 failed、0 skipped。
- `npx tsc --noEmit`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `npx next build`：PASS；route manifest 包含 `/admin/billing/webhooks/[id]/reconciliation`。

## 分數與未完成邊界

canonical readiness 維持 73.5：CAT01=7.5、CAT02=8.0、CAT03=8.0、CAT04=6.0、CAT05=8.5、CAT06=7.0、CAT07=9.0、CAT08=7.5、CAT09=7.5、CAT10=4.5；`current_goal_score_change=0`。

本輪沒有呼叫 PayUni、Cloudflare、staging、Production、正式付款／退款／寄信、deployment 或真人簽核；沒有把 export PASS 誤當成 provider reconciliation acceptance。CAT04 仍需要新的 authorized staging／PayUni Sandbox receipt，CAT10 仍需要真人 owner、政策、客服與 external monitoring evidence。

## 安全與回滾

- 沒有讀取或輸出 `.env*` 內容、credential、token、cookie、正式 secret、正式客戶資料或付款資料。
- 沒有降低 coverage threshold、inventory、exclude、skip、assertion 或資料驗證強度。
- FIN-08AA、WP-196、WP-197 terminal no-go 路徑沒有重試。
- 回滾限於本輪 reconciliation export route、detail link、tests 與 evidence／control-plane metadata；既有 dirty worktree 變更全部保留。

## 下一步

繼續 FUNC-CLOSURE，選擇下一個尚未關閉且能改善販售／帳務流程的 P1；再進入 CAT06 staging matrix、CAT10 真人／營運 evidence 與 QUAL coverage gate。
