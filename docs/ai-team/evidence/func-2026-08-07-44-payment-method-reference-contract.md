# FUNC-2026-08-07-44｜Payment method reference safe contract

## 結果

完成本機產品功能包，補上 Stream 額度啟用前的付款方式 reference contract。`PaymentMethodReference` 是獨立模型，不與商家 payout／configuration 用的 `PaymentAccount` 混用。provider customer／payment method 只以 opaque reference 保存，card-like number、空白與不完整 membership scope 會被拒絕。

直播規則新增 `VENDOR`／`MEMBER` 付款人範圍。啟用 member 或 page quota 時，server action 會要求對應 vendor 或每一個 configured membership 都有 verified 且未過期的 reference；缺少時 fail closed，不建立或更新直播。前後台表單也會明確說明目前沒有自動扣款。

payment provider adapter 新增 optional setup-session contract，提供後續 provider setup 的安全型別邊界。PayUni setup、recurring charge、auto-charge 與外部付款尚未實作，本輪沒有呼叫 PayUni 或任何外部付款服務。

## 實作範圍

- `prisma/schema.prisma`
  - 新增 `PaymentMethodReference`，含 vendor／membership scope、provider opaque references、verified／expiry state 與查詢索引。
- `prisma/migrations/20260808060000_payment_method_reference/migration.sql`
  - additive migration；排在 `TeamMembership` composite unique index 建立後，避免 FK ordering failure。
- `src/lib/payment-method-reference.ts`
  - reference normalization、card-like input rejection、active reference assertion。
- `src/lib/live-quota-policy.ts`、`src/app/actions.ts`
  - payer scope normalization 與 quota enablement fail-closed guard。
- `src/lib/payment-providers/types.ts`
  - optional setup-session adapter contract；未把未完成 provider implementation 宣稱為可用。
- 直播建立／編輯 UI
  - 付款人選擇與 `payment_method_required` 錯誤提示。

## 驗證

- combined targeted regression：5 files／175 tests，175 passed、0 failed、0 skipped。
- post-refactor action／payment rerun：2 files／159 tests，159 passed。
- `npx prisma validate`：PASS。
- `npx prisma generate`：PASS。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git -c core.autocrlf=false diff --check`：PASS，exit 0。
- disposable loopback PostgreSQL：32/32 migrations，validate／deploy／status 全 PASS；container／tempRoot cleanup PASS；未讀取 `.env*`，未保存 raw output，無 persistent volume。

## 分數與限制

- readiness truth：PASS；canonical total 仍為 73.5。
- CAT04=6.0、CAT10=4.5；sandbox_ready=false、production_ready=false；current Goal score change=0。
- Global coverage 本輪未重跑。最新 authoritative baseline 是 QUAL-2026-08-07-30 的 statements／branches／functions／lines 42.53／48.19／51.34／61.86 對 63／57／60／65，exit 1 `FAIL_REMAINING_SOURCE_INVENTORY`；這不是本輪 current-tree coverage。
- 本輪沒有 staging、PayUni Sandbox receipt、正式付款、正式退款、Production、部署或真人法律／財務／release 簽核，因此不更新 CAT04／CAT10 分數。
- 沒有讀取或輸出 credential、token、cookie、正式 secret、正式客戶資料或付款資料；沒有重試 FIN-08AA、WP-196、WP-197。

## 下一步

繼續處理 provider setup 的 sandbox-safe implementation 與 deterministic failure／retry policy；若要讓 CAT04 分數上升，仍需要授權的 staging reconciliation、PayUni Sandbox receipt 與可追溯 acceptance。CAT10 則需要真人 merchant／support／legal／privacy／finance／release owner evidence 與外部 monitoring evidence。
