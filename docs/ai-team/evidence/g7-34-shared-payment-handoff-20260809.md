# G7-34 共用付款 handoff 與方案交易用途邊界 checkpoint

日期：2026-08-09

狀態：`ACCEPTED_LOCAL`。方案訂閱與月結帳單的 PayUni form-post 現在共用同一個 pending／同步防重送 control；方案頁只會向 owner 顯示且只接受通過付款用途、tenant、plan 與 pending subscription 驗證的交易。

## 實際修改

- 將方案頁專用 `ExternalPaymentForm` 提升到共用 components，方案與帳單付款使用同一份 native form-post、防重送、pending 與 live status 行為。
- 共用 form 第一次 submit 保留 native 行為；同步 submitted ref 在 React commit 前阻擋第二次 submit。
- 月結帳單的 PayUni handoff 新增 pending、disabled、`aria-busy`、polite live status；新分頁 form 使用 `rel="noopener noreferrer"`。
- 方案 pending checkout 新增 server-side binding：只限 owner，transaction 必須是目前 vendor 的 platform pending payment，metadata purpose 必須為 `platform_subscription_checkout`。
- Metadata 內 `platformSubscriptionId` 與 `billingPlanId` 必須有效，且另查同 vendor、同 plan、狀態為 `pending_payment` 的 subscription；任一條件不符即 fail closed，不渲染 provider form。
- 錯用途、失效或不屬於目前方案變更的 checkout 會顯示明確 alert，說明系統沒有送出付款資料。
- PayUni payload presentation 維持完整四欄 allowlist：`MerID`、`Version`、`EncryptInfo`、`HashInfo`。

## Ownership 與安全邊界

- Client form 不判斷 transaction ownership、purpose 或 provider URL；所有 checkout binding、URL allowlist 與 payload sanitation 都在 server presentation path 完成。
- Non-owner 不查詢也不渲染方案 pending transaction；已取得 transaction ID 也不能送出方案付款 handoff。
- Invoice transaction 即使同 vendor、paymentMode=platform、status=pending，也不能在方案頁被誤呈現或送出。
- Server Action、PayUni adapter、webhook、subscription activation、invoice mutation、CSRF 與 DB schema 沒有更動。
- 沒有讀取或輸出 `.env*`、secret、Token、Cookie、正式客戶或付款資料。
- 沒有 DB、外部服務、正式付款、正式退款、正式寄信或 Production 操作。
- 沒有重跑 FIN-08AA、WP-196、WP-197 的 terminal endpoint、probe 或失敗命令。

## Fresh deterministic evidence

- 最終 UTC：`2026-08-09T09:19:29.0166043Z`。
- Final related regression：7 test files、`51/51 PASS`、failed=`0`、exit code=`0`。
- 關鍵 cases：shared form initial／pending／double-submit、新分頁 opener protection、PayUni field allowlist、tenant-scoped invoice checkout、owner-only plan checkout、wrong billing purpose fail-closed、pending subscription binding、方案／帳單 actions regression。
- 額外 invoice domain regression：2 test files、`11/11 PASS`、failed=`0`、exit code=`0`；此命令早於 final 51-test command，重疊項目不重複加總。
- Scoped ESLint：PASS，exit code=`0`。
- Full `npm run typecheck`：PASS，exit code=`0`。
- Scoped `git diff --check`：exit code=`0`；只有既有 Windows LF／CRLF warning，沒有 whitespace error。
- Fixed-function score reconciliation：`4/4 PASS`、exit code=`0`；evidence path／SHA-256、固定 inventory、canonical 74.0 與 blocker 宣告一致。
- React review checklist：hooks 無條件呼叫；共用 client state 沒有 data fetch／waterfall；server page 只傳 sanitized string action／payload；保留 native keyboard submit；無新增 dependency。
- 本 WP 沒有執行 Browser、staging、PayUni Sandbox、disposable PostgreSQL 或 Production；未執行項目不列為 PASS。

## Reviewer

- 第一輪 AI Team 唯讀 reviewer 找到 1 個 P1：方案頁未驗 billing purpose，可能把同 vendor 的 invoice transaction 誤呈現成方案付款。
- 第一輪另找到 1 個 P2：非 owner 雖不能建立方案交易，仍可能藉 transaction ID 送出既有 handoff。
- 新增 owner gate、purpose、subscription／plan binding 與 fail-closed tests 後，原 reviewer 最終複核為 `RESOLVED`，沒有未解決 P0／P1／P2。
- Reviewer 全程唯讀、沒有修改檔案，也沒有執行測試。

## Source digests

- `81e5c8f9cf9a43df23ace3f7a6f093474ac458960298569800c876bbe7bbdaab  src/components/external-payment-form.tsx`
- `0bd4b9ba0a9bad9415a02b56b0a32aa651cda786b7b6a0ab0dfc1c8115ca3247  src/components/external-payment-form.test.tsx`
- `7d6e1b71b88a5b09a64146aea2106b176a7c60b382a3fdd442dbc50984f51aa3  src/app/(app)/billing/plans/page.tsx`
- `86a13ae275715c71bdb7310d5eec1d68ddd8edaf9becaf6967837a492bb2b8f7  src/app/(app)/billing/plans/page.test.tsx`
- `f548f79198e5f4dd8569665459f6cb87cdfd3ea17b819f7ef6be7d66fee27766  src/app/(app)/billing/plans/page.source-attribution.test.tsx`
- `ffa69e9a96785c6c3d6fc7ff6ecd53d5650f4eb8a9763a1e3d927d8e899b4fae  src/app/(app)/billing/invoices/[invoiceId]/page.tsx`
- `7f32a5061e422abbbe52d06e8abf5c849a9b251ff97ad8b8557e13d450516766  src/app/(app)/billing/invoices/[invoiceId]/page.test.tsx`
- `0610128ff4d1e69ac57dfa98c44af0aec7ed570115def4384891989c085c2800  src/lib/payment-checkout-presentation.ts`
- `5355369a6c392c0fe5482802798bd5bd3926c6dad746fc91352a5c4622d6473a  src/lib/payment-checkout-presentation.test.ts`

## 分數判斷

- 固定功能 `Checkout／付款`：`8.5 → 8.6`，UX `1.6 → 1.7`。
- 提升來源：月結帳單取得與方案一致的 pending／防重送行為；方案 checkout 增加 owner、billing purpose 與 pending subscription binding，避免錯用途真實付款。
- Latest canonical total 維持 `74.0`。本機 deterministic evidence 不能代替 CAT04 PayUni Sandbox／staging，也不能代替 CAT10 真人簽核與外部監控交付。
- CAT04／CAT10 保持 blocker，不阻擋其他產品工作。

## 人工與外部 blocker

- 本 WP 沒有新增需要使用者立即處理的事項。
- CAT04 仍需 fresh staging／PayUni Sandbox provider 與 reconciliation evidence。
- CAT10 仍需真人法律、隱私、退款、財務、客服 SLA、release acceptance 與外部監控交付。

## 回滾範圍

- 回滾範圍限於共用 external payment form、方案／帳單 server page 組裝與對應 tests。
- 原 plans-local component 與 test 已由共用 component 取代；回滾時應整體恢復，避免兩份 handoff 行為漂移。
- 沒有 schema、migration、provider adapter、webhook、帳務 mutation 或外部服務副作用。

## 下一個最高價值工作

繼續掃描訂單履約與 onboarding 的 server actions／native forms，優先修正仍缺 action-specific pending、同步防重送、錯用途 binding 或明確失敗恢復的販售流程；完整覆蓋的付款、退款、payout 與 webhook controls 不重做。
