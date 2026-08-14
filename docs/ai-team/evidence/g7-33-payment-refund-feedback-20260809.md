# G7-33 方案付款與退款對帳操作回饋 checkpoint

日期：2026-08-09

狀態：`ACCEPTED_LOCAL`。方案建立付款、PayUni 原生 form-post 離站 handoff 與退款終態對帳現在都有對應實際操作的 pending、disabled、防重送與可存取狀態回饋；退款失敗明確說明本機帳務沒有變更。

## 實際修改

- 方案選擇／變更按鈕改用共用 `FormSubmitButton`，依首次購買或方案變更顯示不同 pending label 與 live message。
- PayUni `form_post` handoff 抽成 client form；保留 server 已驗證的 action 與 sanitized hidden payload，送出後立即顯示「正在前往付款頁」、disabled、`aria-busy` 與 polite live status。
- 外部付款 form 的第一次 submit 保留 native 行為；只有同步重複 submit 會被攔截。Client 沒有重新判斷 provider URL，安全 allowlist 與 payload sanitation 仍由 server presentation contract 負責。
- PayUni checkout presentation 新增完整欄位 allowlist，只允許 `MerID`、`Version`、`EncryptInfo`、`HashInfo`；缺漏、空值、過長或 unsupported provider 都回傳空 payload，未知欄位不會進入外部 form。
- 外部付款 form 使用同步 submitted ref：第一次 native submit 不攔截，React commit 前的第二次 submit 會立即 `preventDefault`。
- 退款終態對帳按鈕改為「查詢並核對中」，live message 明示正在查詢 PayUni Sandbox，避免使用泛用「儲存中」造成誤判。
- 退款對帳結果依成功／失敗使用 `status`／`alert` 與 polite／assertive live region；失敗文案保留「系統未變更本機帳務」。
- 盤點商家客服案件與平台財務 handoff：回覆、備註、owner 指派、狀態轉移、退款交接與財務 review 均已有共用 pending／disabled 控制；本輪不重做已覆蓋流程。

## Ownership 與安全邊界

- 保留既有 billing plan attribution、PayUni action allowlist、sanitized form payload、Server Action、CSRF、角色授權與退款 Serializable reconciliation 邏輯。
- Client component 只接收 server 已過濾的 provider action 與字串 payload；沒有接受 client provider UID、merchant secret 或任意 callback 狀態。
- 沒有讀取或輸出 `.env*`、secret、Token、Cookie、正式客戶或付款資料。
- 沒有 schema、migration、DB、外部服務、正式付款、正式退款、正式寄信或 Production 操作。
- 沒有重跑 FIN-08AA、WP-196、WP-197 的 terminal endpoint、probe 或失敗命令。

## Fresh deterministic evidence

- 最終 UTC：`2026-08-09T09:04:13.6431687Z`。
- Final related regression：10 test files、`77/77 PASS`、failed=`0`、exit code=`0`。
- 關鍵 cases：首次／變更方案 pending、完整 PayUni field allowlist、未知／缺漏／空／過長／unsupported payload fail-closed、原生 form-post 第一次提交、React commit 前同步阻擋第二次提交、tenant-scoped checkout presentation、平台歸因、退款 provider query、full／partial no-pending 短路、unsupported provider 與失敗 fail-closed。
- Scoped ESLint：PASS，exit code=`0`。
- Full `npm run typecheck`：PASS，exit code=`0`。
- Scoped `git diff --check`：exit code=`0`；只有既有 Windows LF／CRLF warning，沒有 whitespace error。
- Fixed-function score reconciliation：`4/4 PASS`、exit code=`0`；evidence path／SHA-256、固定 inventory、canonical 74.0 與 blocker 宣告一致。
- React review checklist：hooks 無條件呼叫；本地 pending state 只負責離站回饋；沒有新增 client fetch、waterfall 或 dependency；hidden inputs 使用穩定 provider field name 作 key；保留 native form 與 keyboard submit。
- 本 WP 沒有執行 Browser、staging、PayUni Sandbox、disposable PostgreSQL 或 Production；未執行項目不列為 PASS。

## Reviewer

- 第一位續行 reviewer 因代理生命週期 timeout 沒有回傳 finding；該路徑停止，沒有冒充通過。
- 新 AI Team 唯讀 reviewer 找到 3 個 P2：PayUni payload key 未 allowlist、第一次 React commit 前仍存在第二次 submit race、partial refund 無 pending 時仍可能先查 provider。
- 三項全部修正並補 deterministic tests；原 reviewer 最終複核為 `RESOLVED`，沒有新的 P0／P1／P2。
- Reviewer 全程唯讀、沒有修改檔案，也沒有執行測試。

## 如實保留的中間失敗

- Reviewer 修正後第一輪 related regression：10 files、`76/77 PASS`、1 FAIL、exit code=`1`。產品輸出已正確移除未知 hidden field，但測試搜尋 `unexpected` 誤撞 React 注入字串 `unexpectedly submitted`；收緊成 `name="unexpected"` 後 77/77 PASS，沒有弱化產品 assertion。
- Reviewer 修正後第一輪 full typecheck：exit code=`1`。`safeCheckoutFormPayload` 的空物件分支讓帳單頁 `Object.entries` value 推斷為 `unknown`；明確固定 helper 回傳 `Record<string, string>` 後 typecheck PASS，產品 fail-closed 行為不變。

## Source digests

- `0610128ff4d1e69ac57dfa98c44af0aec7ed570115def4384891989c085c2800  src/lib/payment-checkout-presentation.ts`
- `5355369a6c392c0fe5482802798bd5bd3926c6dad746fc91352a5c4622d6473a  src/lib/payment-checkout-presentation.test.ts`
- `20a8d8ad147c22f726286f0fa63acc0936023cbc58e4e27a1fb36b3cf70dcf52  src/app/(app)/billing/plans/plan-submit-button.tsx`
- `13baf5ac3a8f20da909071163d0ed5dd7a9872ff0b945db407a32b0b2be9b240  src/app/(app)/billing/plans/plan-submit-button.test.tsx`
- `429243f0d15497457b004bfc8f51ed3a7833dd1d196eea40eb7ec1a1301020d9  src/app/(app)/billing/plans/external-payment-form.tsx`
- `ddfbd7cba2e28206154b81d5c9c1d6500b1e395ae94230301ba96beed46cb340  src/app/(app)/billing/plans/external-payment-form.test.tsx`
- `b3e1048fe5dbeb6af1edd8018620f73d2fcf465d60cc5faabcd982bf329f6a77  src/app/(app)/billing/plans/page.tsx`
- `86a13ae275715c71bdb7310d5eec1d68ddd8edaf9becaf6967837a492bb2b8f7  src/app/(app)/billing/plans/page.test.tsx`
- `ed719a9470bca53f68762ea939c6afdb271dcd9ed95309ede3de98fa867d7e0d  src/app/(app)/billing/plans/page.source-attribution.test.tsx`
- `cb59c2ab4034984c06d01e593025f7b49e4a9494dccb9de3567b443f5342db71  src/app/(app)/billing/plans/actions.ts`
- `d21a92cc71005fe4ba2eca5e6997047a1192cdf10a90791420f7b43acedc444e  src/app/(app)/billing/plans/actions.test.ts`
- `cf95c5645f5a15961344653388e0447ba3feaf7b3d80a30e475ac641857aad6c  src/app/(app)/billing/invoices/[invoiceId]/page.test.tsx`
- `3a7cd72da74cbb3d74656c917d0f7c614c6a2c13daf6a066906d49afcdd16bed  src/app/admin/billing/refund-reconciliation/[id]/page.tsx`
- `cdea4710c3a1f5ff4dbc6585afc25f6215a56b2fffa066dd1252e7c2cd26533f  src/app/admin/billing/refund-reconciliation/[id]/page.test.tsx`

## 分數判斷

- 固定功能 `Checkout／付款`：`8.3 → 8.5`，UX `1.4 → 1.6`。
- 固定功能 `退款／客服`：`8.0 → 8.2`，UX `1.4 → 1.6`。
- 提升來源：高風險付款離站與退款對帳具備動作專屬的防重送、可見 pending 與可存取結果回饋，降低重複付款 handoff 與誤判帳務寫入的風險。
- Latest canonical total 維持 `74.0`。本機 UI／deterministic evidence 不能代替 CAT04 PayUni Sandbox／staging，也不能代替 CAT10 真人簽核與外部監控交付。
- CAT04／CAT10 保持 blocker，不阻擋其他產品工作。

## 人工與外部 blocker

- 本 WP 沒有新增需要使用者立即處理的事項。
- CAT04 仍需 fresh staging／PayUni Sandbox provider 與 reconciliation evidence。
- CAT10 仍需真人法律、隱私、退款、財務、客服 SLA、release acceptance 與外部監控交付。

## 回滾範圍

- 回滾範圍限於 billing plan 兩個 client submit controls、方案頁組裝、退款 reconciliation 狀態回饋及對應 tests。
- 沒有 schema、migration、provider contract、Server Action、帳務 mutation 或外部服務副作用。
- 回滾外部 handoff pending 會恢復使用者可連續重複點擊且看不到離站狀態的風險；不建議只回滾 tests。

## 下一個最高價值工作

繼續從販售主流程盤點尚未提供操作中／失敗恢復的商家商品、訂單履約與 onboarding 動作；優先處理會造成重複 mutation、資料遺失或使用者誤判的功能，已完整覆蓋的付款、退款、payout 與 webhook controls 不重做。
