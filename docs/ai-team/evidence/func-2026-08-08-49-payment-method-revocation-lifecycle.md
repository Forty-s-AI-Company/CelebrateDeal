# FUNC-2026-08-08-49｜Payment method revocation lifecycle

## 結果

`COMPLETE_LOCAL_PRODUCT_FIX_NO_SCORE_CHANGE`。本輪把已驗證付款方式的撤銷生命週期補完整：財務角色可以在 `/billing/payment-methods` 撤銷商店或成員 reference；系統先將本機 reference 設為 `revoked`，之後才嘗試 provider-side token cancellation。遠端撤銷失敗或 provider 沒有 adapter 時，本機仍保持 fail closed，並以 sanitized audit 記錄實際結果。

PayUni adapter 使用官方公開 SDK 所列的信用卡 Token cancellation capability：`credit_bind_cancel` 對應 `credit_bind/cancel`，送出 `UseTokenType=1` 與 server-side opaque `BindVal`。本輪只驗證加密 envelope、endpoint、回覆驗證與失敗語意，沒有呼叫 PayUni Sandbox、staging 或 Production。

## 產品修正

- `PaymentProviderAdapter` 新增 optional `revokePaymentMethodReference`，provider token 不跨到 client 或 HTML。
- `PaymentMethodReference` domain 新增 tenant-scoped、idempotent local revoke；找不到其他商家的 reference 時 fail closed。
- Server Action 先 local revoke，再執行 provider cancellation；成功、unsupported、failed 三種結果都寫入不含 token 的 audit snapshot。
- 付款方式頁新增撤銷操作與明確狀態訊息；撤銷後不會再次呼叫 provider。
- PayUni token cancellation 只接受 opaque reference、驗證回覆 hash／解密 payload／merchant identity／SUCCESS status；provider 失敗不會暴露 raw response、URL、key 或 token。

## 驗證

- targeted payment/onboarding regression：10 files／79 tests，79 passed、0 failed、0 skipped。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git -c core.autocrlf=false diff --check`：PASS，exit 0。
- 測試涵蓋 PayUni cancellation envelope、錯誤回覆、local revoke ordering、tenant scope、idempotent revoke、remote failure、sanitized audit 與 UI reference 不外洩。

## 分數與邊界

canonical readiness 維持 73.5：CAT01=7.5、CAT02=8.0、CAT03=8.0、CAT04=6.0、CAT05=8.5、CAT06=7.0、CAT07=9.0、CAT08=7.5、CAT09=7.5、CAT10=4.5；`current_goal_score_change=0`。本輪沒有取得 PayUni Sandbox receipt、staging reconciliation 或真人 CAT10 acceptance，因此不宣稱 CAT04／CAT10 加分、`SANDBOX_READY` 或 `PRODUCTION_READY`。

## 安全與回滾

- 未讀取或輸出 `.env*`、credential、token、cookie、正式資料或付款資料。
- 未執行正式付款、退款、寄信、資料庫操作、部署、push、merge，亦未重試 FIN-08AA／WP-196／WP-197 或既有 terminal command。
- 無 schema／migration 變更；回滾範圍為本輪新增的 provider cancellation、domain revoke、action、UI、測試與 evidence 檔案，保留其他使用者既有變更。

## 下一步

繼續處理正式 PayUni setup session／callback 欄位契約或其他可 deterministic 驗證的販售功能；CAT04 仍只接受新的官方規格、授權 staging／Sandbox receipt，CAT10 仍只接受真人 merchant、support、legal/privacy/refund、finance、monitoring 與 release owner evidence。
