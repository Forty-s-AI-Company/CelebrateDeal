# PR #455 複審：Line A 付款／退款／月結修正

- 分支：`codex/beta-l1b-lineA-payments`，HEAD `1cba5f18`
- 範圍：`git diff 79a2f706..HEAD`。這段範圍含 `51e7a5c5` 加上 7 個修正 commit；我也對 `origin/master..HEAD` 做了整體比對。
- 對照：`36-pr455-lineA-review.md`
- 審查日期：2026-10-21。審查期間只讀，沒有修改任何程式。

## 我實際跑過的驗證

| 指令 | 結果 |
|---|---|
| `npx vitest run`：money-input、payment-gateway-fee、payment-order-number、payment-post-refund、payuni-refund-hold-release、payuni-refund-reconciliation、billing、settlement-adjustment（新增）、actions、refund-reconciliation page、settlements page ×2、checkout route、payuni-refund-execution | 14 個檔案、594 個測試全部通過 |
| `npx tsc --noEmit` | 通過 |
| `npx eslint <所有變更的 ts/tsx/mjs>` | 通過 |
| `node --test scripts/prisma-drift-check.test.mjs` | 7/7 通過 |
| `*.db.test.ts`，包含新增的 `payment-gateway-fee.db.test.ts`、`payuni-refund-reconciliation-hook.db.test.ts`，以及 hold-release、settlement-adjustment 新增的案例 | **未執行**：本機 `127.0.0.1:54329` 沒有啟動資料庫。我寫這份報告時，HEAD `1cba5f18` 的 CI `quality` 狀態是 `IN_PROGRESS`。 |

## 逐條狀態

| # | 原等級 | 狀態 | 依據 |
|---|---|---|---|
| M-1 | MAJOR | **已修正** | `payuni-refund-hold-release.ts`：只有同時符合兩個條件的確認才會計數：(1) `now ≥ createdAt + 時間窗`；(2) `now ≥ 上一次計數的時間 + minIntervalMs`，預設 6 小時。太早或間隔不足的查詢只寫 audit（`counted: false`），不會改動欄位，所以連按也不會把下一次可計數的時間往後推。釋放必須「本次有計數，且累計次數達門檻」。照預設值，最早要在保留建立 36 小時後才能釋放。**時間完全由伺服器決定**：`now` 只來自 `input.now ?? new Date()`，而頁面兩處呼叫（`page.tsx:129`、`:161`）都沒有傳 `now` 或 `policy`。`createdAt` 和 `providerNoRefundLastCheckedAt` 取自 DB，policy 取自伺服器 env，env 的上下限是次數 2–20、時間窗 1–720 小時、間隔 1–168 小時。client 只能送出 `id` 與 `refundRecordId`，兩者都會和 URL 以及 DB 中唯一的 pending 紀錄比對，client 沒有任何方式影響時間判斷。另外新增了 DB 測試「1 分鐘內按 3 次不會釋放」。 |
| m-1 | MINOR | **已修正** | `payment-gateway-fee.ts` 的優先順序：(1) 本次事件由 provider 回報費用時，一律採用 provider 值；(2) 若 provider 沒回報，而 stored metadata 已有 `feeSource`（`provider` 或 `contract_rate`），就保留 stored 的費用與淨額，不改寫 metadata；(3) 只有第一個 paid 事件、而且還沒有任何 `feeSource` 時，才依合約費率寫入。所以通知重送、admin retry 或改了 env 費率，都不會覆蓋已存的值。新增的 DB 測試涵蓋這個情境，但我沒有實際跑。 |
| m-2 | MINOR | **已修正（數值仍待 D-30 確認）** | 新台幣手續費改為四捨五入到整數元（100 分的倍數），其他幣別仍算到分；metadata 會記錄 `roundingUnitCents` 與 `rounding`。目前 callback 只接受 `PaymentType=1`，所以 ATM／超商不會套到信用卡費率；費率依付款類型區分的部分，留給 D-30 決定。 |
| m-3 | MINOR | **已修正** | `actions.ts` 的非 PayUni 手動退款，現在在同一個交易中呼叫 `applyPostRefundInTransaction`，commit 之後再呼叫 `applyPostRefundAfterCommit`。四條退款路徑因此一致。 |
| m-4 | MINOR | **已修正** | `lockSettlementAction` 在同一個交易中呼叫 `closePendingAdjustmentsOnLock`，把 pending 申請標為 `rejected_by_lock`，記錄 `reviewedBy`／`reviewedAt`，並逐筆寫 audit。月結頁會列出被自動退回的申請。 |
| m-5 | MINOR | **已修正** | 新增 `settlement-adjustment.test.ts`，涵蓋併發衝突（`updatedAt` 條件不符時回 `conflict`，而且不寫 audit）、P2034／P2002，以及負數金額。新增 `payuni-refund-reconciliation-hook.db.test.ts`：對帳完成全額退款後，會釋放庫存並作廢已排入佇列的發票。新增 fee 重送與 M-1 的測試。所有 DB 測試都要等 CI 跑完才算確認。 |
| m-6 | MINOR | **已處理** | runbook 第 4 節新增部署前的只讀查重 SQL、遇到 P3009 的處理步驟，以及查詢紀錄。staging 在 2026-10-21 的查詢結果是 0 組；production 欄位還是「待執行」，要由 owner 在部署前執行。 |
| n-1 | NIT | **已修正** | `actions.ts` 已改回 CRLF：HEAD 共 2347 行，每一行都以 CR 結尾，沒有混用。和 master 相比，`--stat` 是 +97／-241，與忽略行尾差異時的結果相同，表示 diff 只剩實質變更。 |
| n-2 | NIT | **已修正** | 只要「新值的絕對值」或「與現值的差額」任一超過門檻，就需要第二人覆核。有單元測試與 DB 測試。 |
| n-3 | NIT | **已修正** | 輸入上限改為 NT$21,474,836，換算成分後在 int4 範圍內，超過時回 `invalid_adjustment`。 |
| n-4 | NIT | **已處理（文件）** | runbook 新增 4.1 節，說明 hook 在交易內 throw 時代表資料不一致，需要人工處理。 |
| n-5 | NIT | **已處理（文件）** | 同 4.1 節，記錄歷史退款不會補跑 hook。 |
| n-6 | NIT | 維持 | 退款仍不需要第二人覆核，這是可以接受的殘餘風險。 |

## 新 migration `20261021110400_settlement_adjustment_rejected_by_lock`

- 只往前，而且不改任何資料列：先 DROP、再 ADD `SettlementAdjustmentRequest_status_check`，新增 `rejected_by_lock` 值，原本的值全部保留，所以既有資料一定通過新的 CHECK。`review_check` 要求「非 pending 必須有 reviewer」，`closePendingAdjustmentsOnLock` 會寫入 reviewer，兩者相符。
- 名稱排序晚於 master 最新的 `20261020090000_enable_rls_all_tables`，也晚於本 PR 的 `110300`。`origin/master..HEAD` 範圍內的 `prisma/` 只有新增檔案，沒有改動任何既有的 migration。
- 數量一致：114 個 migration、150 個 model，與 `PRISMA_INVARIANTS.md` 相符；drift 基準更新到 `20261021110400`。

## 新發現

| # | 等級 | 位置 | 說明 | 建議 |
|---|---|---|---|---|
| R-1 | NIT | `src/lib/settlement-adjustment.ts`（`closePendingAdjustmentsOnLock`）；`src/app/actions.ts:1748-1750` | `closed.count !== 1` 時會丟出 `SettlementAdjustmentError("conflict")`，但 lock action 的 catch 只轉換 `SettlementMutationConflict`、`CoursePayoutMutationConflict` 與 Prisma 衝突，所以這個錯誤會變成 500，而不是 `?error=conflict`。在 Serializable 交易下，同時發生的修改通常會先以 P2034 失敗，這條路徑幾乎走不到；即使走到，交易也會整筆 rollback，不會留下錯誤資料。 | 在 catch 中加上 `error instanceof SettlementAdjustmentError`，或在 helper 改丟 `SettlementMutationConflict`。 |

本次沒有發現 BLOCKER、MAJOR 或 MINOR 等級的問題。

## 範圍外提醒（沿用初審）

- `calculateSettlement` 沒有排除 `platform_subscription_checkout` 與 `invoice_payment` 這兩類交易，仍需要另開單確認。這不影響本 PR 的結論。

## 結論

初審的 M-1 與所有 MINOR 都已修正或處理。M-1 的時間窗與最短間隔都只由伺服器時間和 DB 資料決定；手續費「provider 回報值優先，其次是已存值」的優先順序正確；新 migration 只往前，排序也正確；`actions.ts` 的 diff 只剩實質變更。合併前提是 CI `quality`（含 DB 測試）在 HEAD `1cba5f18` 跑完並全部通過，branch protection 也會強制這一點；另外，production 的查重 SQL 必須在部署前由 owner 執行。

**可合併**
