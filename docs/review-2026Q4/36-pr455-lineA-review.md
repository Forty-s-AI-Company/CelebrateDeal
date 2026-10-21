# PR #455 審查：Line A 付款／退款／月結（F-040、F-045、F-046、F-049、F-050）

- 分支：`codex/beta-l1b-lineA-payments`（7 個 commit，`898aacf9..51e7a5c5`）
- 範圍：`git diff origin/master..HEAD`（已 `git fetch origin master`），worktree `C:\Users\eden\Downloads\AI\CelebrateDeal-wt-lineA`
- 背景：`13-payments-finance.md`（B03-04、10、11、14、15）、`14-data-migration.md`（B04-06）
- 審查日期：2026-10-21；審查者只讀，沒有修改程式

## 我實際跑過的驗證

| 指令 | 結果 |
|---|---|
| `npx vitest run`：money-input、payment-gateway-fee、payment-order-number、payment-post-refund、payuni-refund-hold-release、payuni-refund-reconciliation、billing、actions、refund-reconciliation page、settlements page ×2、checkout route、payuni-refund-execution | 13 個檔案、578 個測試通過 |
| `src/lib/payment-webhooks.test.ts`（需要 DB） | 54 個失敗，原因是 `localhost:54329` 連不上，不是程式錯誤；**未驗證** |
| 所有 `*.db.test.ts`（order-number、hold-release、settlement-adjustment、execution-full、wp4、unmanaged-indexes、q1） | 本機沒有 DB，**沒有跑**，需要 CI `quality` 或 loopback DB 的證據 |
| `npx tsc --noEmit` | 通過 |
| `npx eslint <所有變更的 ts/tsx/mjs>` | 通過 |
| `node --test scripts/prisma-drift-check.test.mjs` | 7/7 通過 |
| 固定數 | migrations 113、models 150，與 `PRISMA_INVARIANTS.md` 一致；drift 基準維持 100 句；partial unique 從 4 個變成 5 個，allowlist 與 `prisma-unmanaged-indexes.db.test.ts` 都已登記 |

## Findings

| # | 等級 | 位置 | 問題與失敗情境 | 建議修正 |
|---|---|---|---|---|
| M-1 | **MAJOR** | `src/lib/payuni-refund-hold-release.ts:141-144`；`src/app/admin/billing/refund-reconciliation/[id]/page.tsx:128,160` | F-046 的「連續 3 次確認」沒有任何最短間隔，而且時間窗開始前的確認也算數。情境一：保留滿 24 小時時，管理員在 1 分鐘內按兩次「對帳」，再按一次「釋放」，保留就被釋放。情境二：退款不明後第 1 分鐘按兩次，24 小時後再按一次釋放。所以實際的控制只剩「24 小時加上 1 次查詢」，頁面卻寫成連續 3 次確認。若 PayUni 的查詢延遲超過時間窗，或 PayUni 已受理但查詢還沒顯示，釋放後管理員可以再退一次款，造成重複退款。這是付款流出路徑，修正成本又低。 | 只有在 `now - providerNoRefundLastCheckedAt >= 最短間隔` 時才遞增次數。最短間隔例如 1 小時，用 env 設定並設上下限；間隔不足時只記 audit，不增加次數。另外可要求第一次計數的確認必須在 `createdAt + 時間窗/2` 之後。DB 測試要補「短時間連按不會釋放」。 |
| m-1 | MINOR | `src/lib/payment-gateway-fee.ts:76-90`；`src/lib/payment-webhooks.ts:1056` | 同一筆交易若之後又收到一個不帶費用的 paid 事件，系統會依當下 env 費率重算 `gatewayFeeCents`／`netAmountCents`，並把 `feeSource` 覆寫成 `contract_rate`。事件 id 不同的 notify 重送、管理員按 webhook retry、或期間改過 `PAYUNI_*_BPS`，都會觸發。單一事件內 provider 有回費用時會用 provider 值，這部分正確；但「先前 provider 回報的值」或「舊費率」會被後來的事件覆蓋，讓已存的 commission `netReferenceAmountCents` 和退款的淨額參考不一致。 | `currentTransaction` 已是 `paid` 且 metadata 有 `feeSource` 時，沿用 stored 的費用與淨額，不重算。補一個重送 paid 的測試。 |
| m-2 | MINOR | `src/lib/payment-gateway-fee.ts:44-50,87` | 費用目前以「分」四捨五入，例如 NT$1,200 算出 3,528 分，也就是 NT$35.28。PayUni 實際手續費與撥款都以整數元計，月結 `finalPayoutAmountCents` 因此會帶出不是整數元的金額，出款與對帳會出現 1 元以內的差額。另外 `basis` 固定為 `payuni_credit`。目前 callback 只接受 `PaymentType=1`，所以 ATM／超商不會套到信用卡費率；但如果之後開放 ATM／超商，或人工對帳（R448-01）的 ATM／超商款走 paid 路徑，就會被套 2.8%，而 ATM 實際上是固定費。 | 請 D-30 同時決定捨入單位與方向（每筆捨入到整數元，或出款時再捨入），並把它寫成參數。費率改依 `PaymentType` 選擇；遇到未知類型時 fail closed，改走人工處理，不要預設套信用卡費率。 |
| m-3 | MINOR | `src/app/actions.ts:2207-2290`（非 PayUni 手動退款） | 這條路徑沒有接 F-045 的 hook。ecpay-like／demo 等 provider 全額退款後，庫存仍是 committed、不會回補，電子發票也不會作廢或折讓。這是既有缺口，不是本 PR 引入，但現在三條 PayUni 路徑一致，只剩這條不一致。 | 在同一個 serializable 交易內呼叫 `applyPostRefundInTransaction`，commit 後呼叫 `applyPostRefundAfterCommit`；或在 production 直接拒絕非 PayUni 的手動退款。 |
| m-4 | MINOR | `src/app/actions.ts:1609`（`lockSettlementAction`）；`src/lib/settlement-adjustment.ts:180-207` | 月結鎖定後，pending 的大額調整申請會永遠停在 pending。核准會被擋，回 `locked`，所以沒有金額錯誤；但申請人可能以為已經生效，稽核紀錄上也缺少「鎖定時被關閉」這一筆。 | 鎖定時在同一交易把 pending 申請標為 `superseded` 或 `rejected` 並寫 audit；或在還有 pending 時拒絕鎖定。 |
| m-5 | MINOR | `src/app/actions.test.ts`（刪除「settlement version changes concurrently」與「rejects a negative manual adjustment」）；`src/lib/payuni-refund-reconciliation.test.ts`（只 mock `inventoryReservation.findUnique → null`） | 測試缺口：(a) 調整的樂觀鎖衝突（`updatedAt` 條件更新失敗時回 `conflict`）已沒有測試覆蓋；(b) 對帳完成路徑的 F-045 只有型別層面的接線，沒有斷言庫存確實釋放、發票確實作廢；(c) 沒有 F-040 paid 重送的測試；(d) 沒有 M-1 間隔的測試。另外所有 DB 測試都需要 CI 證據。 | 在 `settlement-adjustment.db.test.ts` 補併發衝突；在對帳 DB 測試補全額退款後 reservation 變成 `released`、發票變成 `voided`；其餘併入 M-1 與 m-1 的修正。 |
| m-6 | MINOR | `prisma/migrations/20261021110100_payment_order_number_unique/migration.sql` | preflight 只要遇到重複就 `RAISE EXCEPTION`，安全上是正確的。但如果 staging 或 production 真的有重複（舊產生器用 `Math.random` 6 碼 base36 加上秒級時間戳），`migrate deploy` 會停在 failed 狀態（P3009），連帶擋住後面 F-046、F-049 的 migration。`CREATE UNIQUE INDEX` 不是 concurrent，建索引期間會擋寫入；目前表很小，影響有限。 | 合併或部署前，在 staging／production 用只讀方式跑同一段 `GROUP BY ... HAVING count(*) > 1`，把結果記錄到 OWNER-ACTIONS 或部署 checklist。 |
| n-1 | NIT | `src/app/actions.ts`（整檔） | 整個檔案從 CRLF 改成 LF。diff 顯示 4810 行變動，實際邏輯只有約 300 行。Line B／C 的 worktree 如果也改了這個檔案，合併時幾乎每一行都會衝突。 | 統一成 LF 本身合理，但請先確認沒有其他 PR 正在改 `actions.ts`，或改成單獨一個只改換行的 commit，並告知其他工作線。 |
| n-2 | NIT | `src/lib/settlement-adjustment.ts:29-31` | 門檻比較的是「新調整值的絕對值」，不是「與原值的差額」。單一管理員可以把 -NT$50,000 改成 +NT$50,000，出款金額擺動 NT$100,000 也不需要覆核。 | 改成 `|new| > T || |new - old| > T` 就需要覆核。 |
| n-3 | NIT | `src/lib/money-input.ts:9`；`SettlementAdjustmentRequest.amountCents INTEGER` | 解析器接受到 999,999,999 元，也就是 99,999,999,900 分，超過 int4 上限。超過約 NT$21,474,836 的大額調整會在寫入時拋出 Prisma 錯誤並回 500，而不是友善的錯誤訊息。不會寫入錯誤資料。 | 解析上限改成 21,474,836 元，或在 domain 層回 `invalid_adjustment`。 |
| n-4 | NIT | `src/lib/payuni-refund-execution.ts`、`payuni-refund-reconciliation.ts`（hook 在交易內） | `applyPaymentInventoryTransition` 遇到 tenant／product mismatch，或商品 updateMany 筆數不是 1 時會 throw。PayUni 已經退款成功後，本地 completion 會因此停在 pending，對帳時也會遇到同一個錯誤。這和 webhook 路徑的行為一致，資料正常時不會發生。 | 在 runbook 註明這種錯誤代表資料不一致，要人工處理；可考慮加告警。 |
| n-5 | NIT | `src/lib/payuni-refund-reconciliation.ts:142`（`already_reconciled`） | 本 PR 部署前就已完成對帳的歷史退款，不會補跑 hook，所以庫存不會補回。 | 如果 beta 期間有這類資料，用一次性只讀查詢確認即可。 |
| n-6 | NIT | 退款未納入第二人覆核 | 可以接受：退款金額上限是剩餘可退額度，款項退回原付款人，路徑上有 MFA、CSRF 與 audit。建議登記為殘餘風險，之後再評估是否對大額退款設門檻。 | 登記到 D 清單。 |

BLOCKER：沒有發現。

## 逐項回答主對話的重點

1. **F-050**：`(providerName, orderNumber)` 是全欄位 unique。PostgreSQL 預設 NULLS DISTINCT，所以多筆 NULL 訂單號可以並存，效果等同 `WHERE orderNumber IS NOT NULL` 的 partial index，DB 測試也有涵蓋。訂單號用 `randomBytes(14) & 31` 對應 Crockford 32 字元，分布均勻，共 70 bits，總長 24 字元，符合 PayUni 25 字元的限制。P2002 重試包住整個 `$transaction`；第一次失敗會完整 rollback，checkout 的 `createReservedPaymentTransaction` 只有在同一 idempotency key 已存在時才轉成 `CheckoutIdempotencyConflictError`，所以撞號不會被誤判成 idempotency 衝突，也不會留下只建一半的交易。preflight 只輸出數量，不輸出訂單號或租戶資料。請見 m-6。
2. **F-045**：hook 用 `releaseReservation` 的狀態 CAS（`updateMany where status`）保證冪等，同一筆庫存不會釋放兩次。發票作廢或折讓只在 accounting 回傳 `commerceOrderRefund` 時才執行，accounting 以 event identity 去重，而且只在 commit 後執行、錯誤會被吞掉，不會回滾已完成的退款。admin、webhook、對帳三條 PayUni 路徑都已接上。非 PayUni 手動退款沒有接，請見 m-3。
3. **F-046**：授權（平台管理員、MFA、CSRF、URL id 綁定）、同一交易內寫 audit、以 count 做 CAS 防併發，都正確。「連續確認次數包含當下這次查詢」的設計沒有問題，但需要加上最短間隔，請見 M-1。provider 回報「退款處理中」時會丟 `provider_response`，既不計次也不歸零，屬於 fail closed，可以接受。
4. **F-049**：「不同帳號才能覆核」由伺服器（`requestedBy === actor.id`，id 取自 `requireFinanceAdmin` 的 user.id）與 DB CHECK 雙重強制。鎖單後 pending 申請的處理請見 m-4。退款不納入覆核可以接受，請見 n-6。
5. **F-040**：佣金以毛額計算（`commissionBaseAmountCents = gross`），手續費只影響 `netReferenceAmountCents` 和月結的 `paymentGatewayFeeCents`。`feeSource` 只寫在 metadata，月結和佣金都不讀它，這是正確的，因為它們讀的是金額欄位。單一事件內 provider 有回 NetAmount 時不會被覆蓋，但後續事件會，請見 m-1。捨入方式與 ATM／超商請見 m-2。平台訂閱交易也會被扣費率，請見下方「範圍外」。
6. **刪除的 183 行**：確認不可達。master 上同一個 `if (providerName === "payuni")` 出現兩次，第一個區塊的每個分支都以 `redirect()` 結尾，而 `redirect()` 會 throw、不會 return。
7. **測試與固定數**：固定數一致；缺口請見 m-5；DB 測試需要 CI 證據。

## 範圍外的既有問題（建議另開單，優先確認）

- `src/lib/billing.ts:204-209` 的 `calculateSettlement` 撈出商家所有 `paid/partially_refunded/refunded` 交易時，沒有排除 `metadata.billingPurpose` 為 `platform_subscription_checkout` 或 `invoice_payment` 的交易。這兩種是**商家付給平台**的款項。如果它們算進商家毛額，商家付給平台的訂閱費會在月結時被當成營收撥回給商家；F-040 之後，這些交易還會被扣一筆合約手續費。這不是本 PR 引入的問題，也不影響本次結論，但牽涉金額，請 engineer-hard 先確認。

## 結論

沒有 BLOCKER。有一個 MAJOR（M-1：人工釋放沒有最短確認間隔）。其餘 MINOR 可以在同一輪修正或另外開單，但 m-6 的 production preflight 查詢必須在部署前完成。M-1 修正並補測試，加上 CI DB 測試通過的證據後，只需針對 M-1 與 m-1 做一次小範圍複審。

**需修正後再審**
