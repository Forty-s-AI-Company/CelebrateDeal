# PR #471 審查：結帳頁發票欄位驗證時機與「收件資料同購買人」

- 分支：`codex/beta-checkout-form-fixes`，commit `77e509b8`，比對 `origin/master`（merge-base `8a7ae383`）
- 範圍：`src/components/checkout-invoice-fields.tsx`、`src/components/commerce-checkout-form.tsx`、兩個元件測試、`tests/e2e/commerce-orders.spec.ts`（兩行）
- 審查者：reviewer（Opus），2026-10-23
- 結論：**可合併**（程式面沒有 BLOCKER 或 MAJOR）。不過 `quality` CI 目前是紅燈，原因是 `npm audit` 的 next／@sentry/nextjs critical advisory，與本 PR 無關；後續的單元測試與 e2e 步驟也因此在 CI 上沒有執行。依規定仍要等 CI 綠燈才能合併。

## 檢查結果

1. 金流：`handleSubmit`、`checkoutInvoice()`、admission／checkout 兩次 fetch、idempotency key、`rememberCheckoutAttempt`（只存 vendorId、productId、key）、付款導向與目的地白名單，這些在 diff 中都沒有改動。金額仍只用伺服器的 `confirmedOffer`／props 顯示，送出內容不含金額。無發現。
2. 租戶邊界：沒有新增任何 ID 輸入，也沒有碰到伺服器端，所以無發現。
3. Auth／權限：不涉及。無發現。
4. 資料：沒有 migration 或 schema 變更。送出的欄位名稱與格式和 master 完全一致：`invoiceType`、`invoiceCarrier`、`invoiceCarrierNumber`、`invoiceBusinessId`、`invoiceCompanyName`、`invoiceDonationCode`、`recipientName`、`shippingPhone`，以及其他收件欄位的 `name` 都沒變。新的勾選框沒有 `name`，不會進入 FormData；測試 `commerce-checkout-form-shipping.test.tsx` 也斷言 payload 與 master 同形，且不含 `sameAsBuyer`。伺服器端 `route.ts:390-392` 的 `parseCheckoutInvoiceSelection` 仍回 400，沒有被取代或放寬。
5. 正確性：
   - 前後端驗證一致：前端的 `invoiceInputError` 直接使用 `@/lib/taiwan-invoice-validator` 的 `isValidTaiwanBusinessId`、`isValidDonationCode`（`^[0-9]{3,7}$`）、`isValidMobileBarcode` 與 `isValidCitizenDigitalCertificate`，和伺服器 `validateCheckoutInvoiceSelection` 是同一組函式。前端會先 trim 再檢查，`checkoutInvoice()` 送出的也是 trim 後的值，所以只要前端放行，伺服器一定接受。會員載具回傳 `[]`，不做檢查，不會擋到。
   - 事件順序：React 19.2.4 把 `submit` 委派在 root（`nonDelegatedEvents` 不含 submit），所以 form 節點上的 capture listener 一定比 React 的 `onSubmit` 先執行。擋下時 `preventDefault` 與 `stopImmediatePropagation` 會讓 `handleSubmit` 完全不跑，admission 與 checkout 兩支 API 都不會發出。放行時這個 listener 只會 `setErrors({})`，沒有其他副作用，所以不會造成重複送單。雙擊的防護仍是既有的 `isPending` 加上 disabled。
   - 停用狀態：fieldset 被停用時直接放行（`closest("fieldset[disabled]")`），涵蓋兩步驟模式的第一步、submitting、redirecting 與 success，不會擋到「下一步」。
   - 可繞過但無害：這只是 UX 層的檢查。繞過它（停用 JS 或直接打 API）時，伺服器仍會用同一組驗證回 400。現在無效發票會在 admission 之前就被擋下，比 master 少浪費一次 admission。
   - 原生驗證：`required` 與 `pattern` 都保留；原生驗證先擋下時，`onInvalid` 會補上中文說明。只有空白的抬頭能通過 `required`，會由 submit capture 以 trim 規則擋下。
   - 同購買人：預設勾選；只有 `physical` 會渲染這個區塊（`checkoutRequiresShipping`）；取消勾選時保留目前顯示的值；手動修改收件欄位會自動取消勾選；收件欄位不是 readOnly。購買人資料只放在 React state，不寫 sessionStorage、localStorage 或 URL（URL 仍只有 `resume=1`）。實體商品的 `requiresPhone` 為 true，購買人電話必填，所以帶入的電話不會是空值。兩邊的 maxLength 相同（姓名 120、電話 32），帶入的值不會超過長度。
   - 遊標與 IME：購買人欄位維持 uncontrolled，同步的對象是另一個沒有焦點的 input，不會讓購買人欄位的遊標跳動。收件欄位改成 controlled，`value` 等於 DOM 值時 React 不會回寫，因此編輯時遊標不會跳，組字中也不會被覆寫。勾選期間在收件欄位組字時，第一個 input 事件就會取消勾選，並以組字字串作為 state，和 DOM 值一致。
   - 無障礙：錯誤區塊是 `role=alert`，加上 `id` 後由出錯欄位的 `aria-describedby` 關聯，`aria-invalid` 也正確。送出被擋時會把焦點移到第一個錯誤欄位。勾選框包在 `<label>` 內，可存取名稱為「收件資料同購買人」，`aria-describedby` 指向說明文字。label 有 `min-h-11`（44px）且整列可點。
6. 測試：在本機用新測試推演舊版的行為。舊版的 fieldset `onInput` 在切換 select 時就會報錯，沒有 `aria-invalid`，也不會在 submit 時擋下，而且沒有勾選框，所以新測試在舊版上都會失敗。既有斷言沒有刪除或放寬，也沒有 skip。e2e 兩處改用 `getByRole("checkbox", { name: /我已閱讀目前的/u })`，原因是實體商品頁現在有兩個 checkbox，裸的 `getByRole("checkbox")` 會觸發 Playwright strict mode 錯誤，所以這是必要的修正。名稱正確對應政策勾選框，沒有削弱檢查。第 951 行的數位商品頁只有一個 checkbox，不需要改。
7. 無關變更：無。

## Findings

- BLOCKER：無。
- MAJOR：無（本 PR 引入的部分）。

- MINOR `src/components/commerce-checkout-form.tsx:120-122, 258`：瀏覽器還原表單時，收件欄位與 state 會不同步。
  - 情境：Firefox 一般重新整理（F5）或不走 bfcache 的歷史導覽時，瀏覽器會在 hydration 前還原 input 的值。React 在 hydration 時保留 DOM 值（`initInput` 中 `isHydrating || … element.value = value`），也不會觸發 onChange，所以 `buyerContact` 是 `{name:"", phone:""}`，`sameAsBuyer` 是 true。這時畫面上的收件欄位仍有還原的值，但只要 `CheckoutShippingFields` 重新渲染一次（例如修改購買人姓名，或按送出後 phase 變成 submitting），controlled 的 `recipientName`／`shippingPhone` 就會被改成 state 的值：電話被清空，或收件人變成空白。
  - 影響：資料本身沒有風險，因為 FormData 在 setPhase 之前就讀取了 DOM 值，payload 正確。但伺服器回錯誤或修改購買人資料後，收件欄位會意外變空，被 `required` 擋住。買家可以手動輸入或重打購買人姓名／電話來恢復；切換勾選框無法恢復，因為它會帶入空的 state。
  - 修法（擇一）：(a) 在 `CommerceCheckoutForm` 掛載時用 `useEffect` 從 form 讀取 `buyerName`／`buyerPhone` 的現值放進 `buyerContact`；`CheckoutShippingFields` 掛載時，如果 DOM 中已有收件值且和購買人不同，就設 `sameAsBuyer=false` 並把 DOM 值放進 `recipient`。(b) 收件欄位維持 uncontrolled，勾選期間由 effect 命令式寫入 `input.value`。

- MINOR `src/components/checkout-invoice-fields.test.tsx:186-200`：送出被擋時不發 API 的整合測試不足。
  - 情境：現有測試只用裸的 `<form onSubmit>` 驗證 React `onSubmit` 沒有被呼叫，沒有在真實的 `CommerceCheckoutForm` 上斷言「統編檢查碼錯誤時 `fetch` 呼叫次數為 0」。未來如果 `CommerceCheckoutForm` 改用 `action`、`onSubmitCapture` 或在 form 上另掛 native listener，事件順序可能改變，而現有測試抓不到。
  - 修法：在 `commerce-checkout-form-shipping.test.tsx`（或另開一個檔）加一個案例：選公司發票並填 `12345678`、dispatch submit，斷言 `fetchMock` 沒有被呼叫，且 `document.activeElement` 是統編欄位。

- NIT `src/components/checkout-invoice-fields.tsx:82-83, 154`：一次只顯示第一個錯誤。公司發票的統編與抬頭同時錯誤時，抬頭欄位有 `aria-invalid=true`，卻沒有關聯任何說明；讀屏使用者要先修好統編才會聽到抬頭的錯誤。可以改成每個欄位各有自己的錯誤 `<p>`，或把所有錯誤都列出。
- NIT `src/components/checkout-invoice-fields.tsx:206`：`role="alert"` 隱含 assertive，又同時加了 `aria-live="polite"`，兩者矛盾（master 就是如此）。建議擇一，例如移除 `aria-live`。
- NIT `src/components/commerce-checkout-form.tsx:123-126`：`editRecipient` 以 render 時的 `shownRecipient` 合併新值。如果同一個 tick 內連續改兩個收件欄位（例如腳本或少數自動填入工具），後一次會用舊值覆蓋前一次。建議改成函式型更新，以目前的 sameAsBuyer／buyer 為基底。
- NIT `src/components/commerce-checkout-form.tsx:127-131`：先手動輸入收件人，再「勾選後取消勾選」，原本手動輸入的值會被購買人資料取代。這和「取消勾選保留畫面上的值」的設計一致，可以接受；如果想保留，可以在勾選時另外暫存手動值。
- NIT：新增的 `invoice-field-error`、`shipping-same-as-buyer-help` 和既有的 `invoice-carrier-help` 一樣是固定 id。如果同一頁出現兩個結帳表單，id 會重複。可以改用 `useId()`。

## 既有問題（非本 PR 引入，不阻擋本 PR）

- MAJOR（既有，待確認）`src/lib/taiwan-invoice-validator.ts:22-33`：統編檢查碼規則是「加權和可被 10 整除」。據我所知，財政部已公告因統編配賦數量不足，檢查邏輯改為「可被 5 整除」，舊號碼仍相容。如果已經有按新規則配發的統編，這些公司買家在 master 上就會被伺服器回 400；本 PR 之後改成在前端直接被擋，結果相同，所以不是本 PR 造成的回歸。建議另開 issue，依財政部正式公告核對後，在 validator 中改成 `sum % 5 === 0 || (digits[6] === 7 && (sum + 1) % 5 === 0)`，並補上新舊規則的測試號碼。前後端共用這個函式，改一處就會兩邊一致。

## 驗證紀錄

- 執行 `npx vitest run` 跑 `checkout-invoice-fields.test.tsx`、`commerce-checkout-form-shipping.test.tsx`、`commerce-checkout-form.test.tsx`、`commerce-checkout-form-recovery.test.tsx`、`commerce-checkout-entry.test.tsx`、`checkout-overlay.test.tsx`、`taiwan-invoice-validator.test.ts`：7 個檔案、60 個案例全部通過。
- `npx eslint` 檢查 5 個變更檔：無錯誤。
- `npm run typecheck`：無錯誤。
- e2e（`tests/e2e/commerce-orders.spec.ts`）：本機**未執行**。CI 的 `quality` 在 Production dependency audit 步驟就失敗（next 16.0.0–16.4.0 與 @sentry/nextjs ≤10.75.1 的 critical advisory），所以 e2e 在 CI 上也**還沒有跑過**。
- 「新測試在舊版會失敗」是依舊版程式推演得出，沒有實際切回舊版執行。
