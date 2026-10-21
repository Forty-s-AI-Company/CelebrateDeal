# PR #458 複審：Line A 修正（對照 39-pr458-lineA-review.md）

- 範圍：`git diff 23314195..HEAD`，HEAD `d313c09e`（7 個修正 commit）
- 審查者：reviewer（Opus），2026-10-21；只審查，未修改程式
- Migration 內容在合併前被修改（`130100` 新增 enum 值 `demo` 與回填規則，`130200` 新增 `AffiliateCommissionLedgerEntry.settlementMonthKey`）。依主對話指示，未合併的 migration 可以直接改，前提是沒有套用到任何共享環境。

## 逐條狀態

| 原編號 | 狀態 | 確認內容 |
|---|---|---|
| M-1 佣金沖回 | 已修正 | 四個 `applyPaymentRefundAccounting` 呼叫點（手動退款、PayUni 完成、對帳、webhook）都傳入同一個交易內算出的 `settlementMonthKey`，refund ledger 記在退款月份。`billing.ts:256-260` 的加總規則：`settlementMonthKey = 本月` 的列直接計入，NULL 的列依佣金月份計入，並加入 void 狀態，兩條分支互斥，不會重複計算。我逐一推算三種情境：(a) 同月退款，accrual +1,000 與 refund −1,000 相抵為 0；(b) 銷售月未鎖定、次月退款，銷售月扣 1,000，退款月回補 1,000，合計正確；(c) 銷售月已鎖定，退款月回補 1,000。人工 void 會寫入 reversal（NULL），留在佣金月份，與修正前等價。refund ledger 與 RefundRecord 寫在同一個交易內，所以 lock 的 stale 檢查（比對退款總額）也涵蓋佣金沖回。DB 測試以精確金額覆蓋 (a) 和 (c)，其中 (c) 驗證 −10,000＋1,000＝結轉 −9,000。 |
| M-2 手續費退回 | 已修正 | 撥款改用未截斷的淨手續費；欄位與發票仍保留非負值。DB 測試：8 月 280＋500 手續費、9 月全額退款，結轉精確為 −9,220。 |
| M-3 退款 fail-closed | 已修正 | 新增 `refundRecord.count`，條件為本月、`processed`、付款是 `unclassified` 且沒有 CommerceOrder；只在 `paymentMode=platform` 時拋錯。有 DB 與單元測試各一。 |
| m-1 負向調整變結轉 | 已修正 | `splitNetPayable`：調整為負時，結轉只取 `min(0, payable)`，撥款最低為 0。有 DB 測試。 |
| m-2 錯誤訊息 | 已修正 | generate action 已加上 `carry_forward_target_locked` 的 redirect。 |
| m-3 Sandbox 誤擋 | 已修正 | demo 交易一律標為 `demo`（回填加上 4 個寫入點），月結排除且不會擋下；自有金流（byo）月份也不擋。有測試。 |
| m-4 lock 與退款的併發測試 | 未處理（MINOR，不阻擋） | SSI 推理仍然成立，四條路徑與 lock 都是 Serializable。真實的 `Promise.all(lock, refund)` 測試可以留待後續補。 |
| m-5 production fallback | 已修正 | 見下節。 |
| n-1 migration 時間戳 | 未變 | 我重跑 `migration-order-check` 的結果是 ok。#457 仍是 OPEN：若 #457 先合併，本 PR 不用改名；若本 PR 先合併，#457 要改名。 |
| n-2、n-3 | 未處理（NIT） | 不阻擋合併。 |

## m-5 與 `ALLOW_NON_PAYUNI_PROVIDERS`

- `isProductionDeployment`（`runtime-policy.ts:34`）先檢查 `VERCEL_ENV=production`，成立就直接回傳 true，這時旗標完全不起作用（`runtime-policy.test.ts:29` 有測試）。所以 Vercel production 即使誤設這個旗標，也不會放行 demo。
- 旗標只在「沒有 `VERCEL_ENV` 且 `NODE_ENV=production`」時有效，也就是非 Vercel 的伺服器。CI 的 `NEXT_PUBLIC_APP_URL` 是 `https://ci.celebratedeal.local`，不是 loopback，所以需要這個旗標；e2e 與 playwright 用的是 loopback URL，本來就不受影響。staging 與 preview 都有 `VERCEL_ENV=preview`，也不受影響。
- 殘餘風險（NIT）：若日後自架 production 時照抄 CI 的 env，或把 `NEXT_PUBLIC_APP_URL` 誤設成 localhost，demo 會被放行。`env.ts` 的 preflight 只看 Vercel production，抓不到這種情況。建議 env check 在「`NODE_ENV=production`、非 loopback、且設了這個旗標」時發出 warning。

## 「佣金部分退款測試失敗一次、之後 4 次通過」是否為真實競態

不是業務競態。我用拋棄式 loopback PostgreSQL（Windows 本機叢集）重跑：

- `payment-webhooks.test.ts` 的「keeps a partially refunded commission eligible…」單獨跑 12 次，全部通過；
- 相關 DB 測試組合跑 15 次。這個測試失敗 1 次，`settlement-revenue` 與 `settlement-carry-forward` 也各失敗 1 次。三次失敗的錯誤都是 `Can't reach database server at 127.0.0.1:54330`，發生在 `calculateSettlement` 的大型 `Promise.all`（本 PR 讓並行查詢多了 3 個）；同時 PostgreSQL log 出現 `connection forcibly closed`。這是 Windows 本機連線在瞬間大量建立時的問題，不是 assertion 錯誤，也沒有出現金額不符。
- 在業務邏輯上，這個測試的銷售、退款與佣金都落在同一個月，firstOpen 月份沒有鎖定，也沒有其他會競爭同一組資料的寫入者。

我無法取得主對話那次失敗的原始輸出。如果那次的錯誤是 assertion（例如 payoutable ≠ 73,600），請把輸出貼來，我會重新判斷。就目前證據，這不列為需修項目。若想減少本機的偶發失敗，可以在本機測試 URL 加上 `connection_limit`（NIT）。

## 新發現

| # | 等級 | 位置 | 說明 | 建議 |
|---|---|---|---|---|
| R-1 | MINOR（需 owner 確認政策） | `src/lib/billing.ts:258` | `settlementMonthKey = 本月` 這條分支不看佣金狀態。若佣金已經付給聯盟夥伴（`paid`），之後退款仍會寫入 refund entry，商家會在退款月份拿回這筆佣金，而聯盟夥伴的款項已付出、不會追回，等於由平台吸收這筆損失。修正前則是由商家吸收。兩種做法都有道理，但需要明確的規則。 | 由 owner 決定由誰吸收。若要由商家吸收，這條分支加上 `commission: { status: { not: "paid" } }`；不論採哪一種，都補一個測試。 |
| R-2 | NIT | `billing.ts:259` | `dispute_lost` 與人工 reversal 仍記在佣金月份，若該月已鎖定，就與 M-1 修正前有相同缺口。 | 列入後續待辦。 |

## 本次實際執行的驗證

- `tsc --noEmit` exit 0；`eslint`（變更的檔案）exit 0
- 單元測試：11 個檔案 189 個測試通過；`actions.test` 加上兩個 payuni refund 單元測試共 388 個通過
- 拋棄式 DB（重建後套用全部 migration）上跑完整 `vitest run .db.test.`（使用合成的 `CSRF_SECRET`）：482 個通過、2 個失敗。一個是上述的連線錯誤；另一個是 `scripts/q1-original-retry-audit.db.test.ts`，在全新 DB 上單獨跑也會失敗，而本 PR 沒有修改 `scripts/` 或 AuditLog，判斷與本 PR 無關（疑似時間窗或既有問題），需以 CI 的結果為準。
- `migration-order-check` ok；`prisma-drift-check` 100/100 matched，unexpected 0
- 未執行：`test:db:concurrency`（缺 wp17 環境）、e2e、coverage

可合併
