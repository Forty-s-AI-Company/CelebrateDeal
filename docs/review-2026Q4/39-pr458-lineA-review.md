# PR #458 獨立審查：Line A 月結（F-038、F-039）、F-047、F-003、F-055、F-146

- 分支：`codex/beta-l1c-lineA-settlement`，HEAD `cbefffb0`，範圍 `git diff origin/master..HEAD`（7 個 commit、50 個檔案）
- 審查者：reviewer（Opus），2026-10-21；只審查，未修改程式
- 背景：`13-payments-finance.md`（B03-02、B03-03、B03-12）、`11-architecture.md`（B01-03）、`14-data-migration.md`（B04-14）

## 結論摘要

兩個原始 BLOCKER 的主體已修正：方案費與帳單款不再算入商家營收（B03-02）；退款月份改用伺服器完成時間、跳過已鎖定月份，負餘額結轉也不再截斷為 0（B03-03）。結轉 ledger 與 Settlement 在同一個 Serializable 交易內同步更新，DB CHECK 也能保護不變式。鎖單與四條退款路徑都是 Serializable，會互相 abort，不會漏帳。

但「退款改記入完成當月」之後，跨月退款的佣金沖回與手續費退回沒有跟著搬到完成當月，造成商家被多扣（M-1、M-2）。另外，F-038 的 fail-closed 只檢查付款，沒有檢查退款（M-3）。這三項屬於金額正確性問題，建議修正後再合併。

BLOCKER：無。

## Findings

| # | 等級 | 位置 | 問題與失敗情境 | 建議修正 |
|---|---|---|---|---|
| M-1 | MAJOR | `src/lib/billing.ts:251-259`（佣金依 `commission.monthKey` 加總）；`src/lib/payment-refund-accounting.ts:117`（refund ledger 掛在原佣金上） | 跨月退款沒有沖回佣金。例：9 月有一筆含聯盟佣金的 10,000 元訂單（佣金 1,000），9 月月結鎖定時已扣掉這 1,000。10 月全額退款，依 F-039 記入 10 月，10 月扣商家 10,000。佣金的 refund ledger（-1,000）仍掛在 9 月那筆佣金上，而 9 月已鎖定、不再重算，所以這 1,000 的沖回永遠不會回到商家身上，商家淨多被扣 1,000。修正前同一筆退款會整筆漏記（B03-03），現在變成反方向的錯誤。sale 月份未鎖定時結果正確，問題只出在 sale 月份已鎖定。 | 佣金沖回應跟退款落在同一期：依 refund ledger entry 的入帳時間加總（或在 refund ledger 上記 `settlementMonthKey`，與 `refundSettlementMonthKey` 同一套規則），月結再把「原佣金月份已鎖定的 refund entry」計入本期的佣金扣除。補一個 DB 測試：sale 月鎖定、次月退款、精確金額。若 owner 決定佣金已付給聯盟夥伴時不退還商家，需寫成明確規則並測試。 |
| M-2 | MINOR→建議一併修 | `src/lib/billing.ts:356`、`:363` | 手續費退回仍被截斷為 0，違反 D-32「不截斷」。退款月份固定為完成月之後，`gatewayFeeRefundCents`／`platformFeeRefundCents` 常常落在沒有對應手續費的月份。`Math.max(0, 當月手續費 − 手續費退回)` 會吃掉超出的部分。例：8 月銷售的手續費 280＋500，9 月全額退款並退回這兩筆手續費，9 月沒有銷售：結轉應為 -9,220，實際為 -10,000，商家多被扣 780。發票金額需要非負的 `transactionServiceFeeCents`，但撥款計算不應截斷。 | 撥款改用未截斷的淨手續費（例如 `payoutable = gross − (gatewayFees − gatewayFeeRefund) − (platformFees − platformFeeRefund) − commissions + carriedIn`），發票仍用截斷後的值。補精確金額測試。 |
| M-3 | MAJOR | `src/lib/billing.ts:243` 與 `:266-274` | F-038 的 fail-closed 只檢查付款，沒有檢查退款。退款 aggregate 只計 `SETTLEMENT_REVENUE_TRANSACTION_WHERE`，但「unclassified 且沒有 CommerceOrder」的計數只看本月 `occurredAt` 的付款。舊的買家付款（2026-08-08 前沒有 CommerceOrder、2026-09-02 前沒有 `billingPurpose`）若在已鎖定月份當作營收撥出，現在對它退款，該筆 processed refund 會被月結靜默排除。平台退錢給買家，卻不向商家扣回。是否會發生取決於既有資料，但這正是本 PR 宣稱要 fail-closed 的情況。 | 再加一個 count：本月 `status=processed`、`paymentTransaction: { purpose: "unclassified", primaryCommerceOrder: { is: null } }` 的 RefundRecord 大於 0 時拋 `UnclassifiedPaymentPurposeError`。lock 時的 `assertSettlementInputsUnchanged` 不需要改。補 DB 測試。 |
| m-1 | MINOR | `src/lib/billing-cycle.ts:204` | 重新產生月結時，既有的負向人工調整可能變成結轉。`netPayable = payoutable + 既有 adjustment`：假設之前核准 -800 時 payoutable 為 1,000，之後新增退款使 payoutable 變成 500，重算後會結轉 -300。這違反「負向調整不得讓撥款低於 0」的規則（`assertAdjustmentKeepsPayout` 只在調整時檢查）。 | 擇一處理並寫入文件：(a) 重算時若 `adjustment < 0` 且 `payoutable + adjustment < 0`，拋 `negative_payout`，要求先撤銷調整；(b) 結轉只取 `min(0, payoutable)`，負向調整最多扣到 0。 |
| m-2 | MINOR | `src/lib/settlement-period.ts:92`；`src/app/actions.ts:1529` | 結轉目標月已鎖定時只報錯，就封測而言可以接受：fail-closed，不會重複扣款，DB 測試也有涵蓋。但有兩個缺口：(1) `generateSettlementAction` 沒有對應 `carry_forward_target_locked`，會落到 `?error=missing`，顯示「找不到指定的商家或月結資料」，這是錯誤的訊息；(2) 若管理員先鎖了後一個月（鎖定順序不受限制），而來源月的退款又變動，來源月會卡在「不能重算」與「鎖定時 stale」之間，只能手動改 DB。 | 在 generate action 加上 `carry_forward_target_locked` 的 redirect，頁面已有對應文案。長期做法：限制鎖定順序（較早月份有 draft 時不可鎖後月），或在目標月已鎖定時另開一筆差額 ledger（需要新的 `kind`）。 |
| m-3 | MINOR | `src/lib/billing.ts:266-274`；`docs/codex-goal/PRISMA_INVARIANTS.md` | 封測 Sandbox 可能被誤擋。staging 在本 PR 之前由 demo 回呼建立的付款沒有 `billingPurpose`，也沒有 CommerceOrder，回填後是 `unclassified`，該商家當月月結會被擋下。這個計數也不分 `paymentMode`：商家自有金流時撥款恆為 0，仍會被擋。 | 部署 staging 前先跑文件中的盤點 SQL，並記入 OWNER-ACTIONS 或 staging runbook。計數可限縮為 `paymentMode = "platform"`。 |
| m-4 | MINOR | 測試 | 沒有真實併發測試。lock 與退款互相 abort 的保證來自 SSI 推理：兩邊都是 Serializable，refund 讀 Settlement 並寫 RefundRecord，lock 讀 RefundRecord 並寫 Settlement，形成 rw 循環，必有一邊 abort。這個推理成立，但目前只有循序的 stale 測試。`payuni-refund-reconciliation.ts:277` 遇到 P2034 不重試，會直接拋給呼叫端（之後重跑安全）。 | 補一個 `Promise.all(lock, refund)` 的 DB 測試，斷言結果只會是「refund 進下一個月」或「lock 回 stale／conflict」。reconciliation 可改用 `withSerializableRetry`。 |
| m-5 | MINOR | `src/lib/payment-providers/runtime-policy.ts:16` | Production 只依 `VERCEL_ENV` 判斷。目前部署拓撲只有 Vercel（`deployment-topology.ts`、`env.ts` 也都以 Vercel 為準），e2e／CI 的 `next start` 可以繼續使用 demo，這部分已確認。風險在於若日後部署到 Vercel 以外的環境，例如自架或 Docker，demo provider 會被允許，而 demo 沒有自己的 production 防護，偽造回呼可以建立 `buyer_order` 營收。 | 加上 fail-closed fallback：`!VERCEL_ENV && NODE_ENV==="production"` 時，除非明確設定 `ALLOW_NON_PAYUNI_PROVIDERS=1`（e2e／CI 才設），否則視為 production。`cloudflare-webhook-signature.ts:112` 已有類似 pattern。 |
| n-1 | NIT | `prisma/migrations/20261021130100_payment_transaction_purpose` | 時間戳與 #457 的 `20261021130100_landing_page_archive_restrict_funnel` 相同。我用 `evaluateMigrationOrder` 模擬兩種合併順序：#457 先合併時，本 PR 的名稱依完整名稱排序（`p` > `l`），通過 `migration-order-check`，不需要改名；本 PR 先合併時，#457 的兩個 migration（130000、130100）都會失敗，必須改名。兩者 DDL 不衝突。後合併者還需要處理 `PRISMA_INVARIANTS.md` 的文件衝突，並更新 model 與 migration 計數（151／116 → +#457）。 | 建議 #457 先合併，或本 PR 改用 `20261021140100`／`140200`，避免同前綴。 |
| n-2 | NIT | `src/app/actions.ts:2220`；dashboard | `?error=refund_provider_unsupported` 在 dashboard 沒有顯示文案（既有的 `error=refund` 也一樣）。 | 加上錯誤訊息區塊。 |
| n-3 | NIT | `src/lib/inventory-reservations.ts` | 5 次重試，每次 `maxWait 5s + timeout 10s`，最壞情況約 75 秒，可能超過 serverless 函式的時限。 | 確認 `maxDuration`，或縮短單次 timeout。 |

## 逐項檢查結果

1. **F-038 回填**：判定順序為 `billingPurpose`（platform／invoice／buyer）優先，其次是「沒有 `billingPurpose` 且同 vendor 的 CommerceOrder 以此為 primary」，其餘歸為 `unclassified`。明確的平台用途優先於 CommerceOrder 連結，正確。我在拋棄式 DB 上用 7 種 metadata（含 null、`{}`、陣列、未知值）實跑 CASE，結果符合預期，沒有出現型別錯誤。所有 PaymentTransaction 建立點（checkout、方案、帳單、demo 回呼）都有寫入 `purpose`。無法判定時 fail-closed，但退款沒有涵蓋（M-3），Sandbox 也可能被誤擋（m-3）。
2. **F-039**：四條退款路徑都在 Serializable 交易內改用 `refundSettlementMonthKey(tx, …, 伺服器時間)`，表單的 `monthKey` 已移除，webhook 也不再採用 provider 時間。結轉部分：`carriedOut = min(0, net)`、`payout = max(0, net)`，ledger 與 Settlement 在同一個交易內更新，餘額平衡，也有串月結轉的測試。正向調整可以抵減結轉，負向調整在調整時不可低於 0（重算時有缺口，見 m-1）。lock 改為 Serializable，並重新比對退款與結轉。既有的未鎖定月結 `refundAmountCents=0`，若該月有退款，必須重新產生，重算時也可能遇到 `unclassified` 或金額變動（已寫入文件）。結轉目標月已鎖定時只報錯，見 m-2。跨月的佣金沖回與手續費退回見 M-1、M-2。
3. **F-047**：failed 事件 ID 為 `<TradeNo|order>:result:<code>`，與 paid 的 `<TradeNo>:<TradeStatus>`、legacy 的 `failed:<id>` 都不會衝突。`resolvePaymentStatus` 不允許 paid 轉為 failed。庫存歸還只在 `status === "reserved"` 時發生，具冪等性。Message 只在符合代碼格式時保留，並排除 12 到 19 位數字。
4. **F-003**：見 m-5。`getPaymentProvider`、webhook（含 retry worker 重放）、本地退款、env check 都有 fail-closed。e2e 不設 `VERCEL_ENV`，或設為 preview，demo 仍可使用。
5. **F-055 `serializable-retry.ts`**：預設只重試 P2034，webhook 明確擴大為 P2034／P2002（沿用既有行為）。full jitter 加上 cap，最後一次失敗後不再 sleep，測試已涵蓋。
6. **Migration**：兩個都是 forward-only，`lock_timeout` 5 秒；第二個是純新增，CHECK 與程式假設一致，新表已啟用 RLS。命名見 n-1。
7. **測試與 gate**：見下節。

## 本次實際執行的驗證

- `node scripts/migration-order-check.mjs`：ok，並以 `evaluateMigrationOrder` 模擬兩種合併順序（結果見 n-1）
- `npx tsc --noEmit`：exit 0；`npx eslint <變更的 .ts/.tsx>`：exit 0
- 單元測試（16 個檔案）：15 個通過。`payment-webhooks.test.ts` 第一次因為沒有本機 DB 而失敗，連上拋棄式 DB 後通過。
- 拋棄式 loopback PostgreSQL（scratchpad 叢集，port 54330，`celebratedeal_ci`）：`prisma migrate deploy` 套用全部 116 個 migration。`settlement-carry-forward.db`、`settlement-revenue.db`、`payuni-signed-rejection.db`、`payuni-refund-execution(.full).db`、`payment-webhooks` 共 6 個檔案、70 個測試全部通過。
- `scripts/prisma-drift-check.mjs`（shadow `celebratedeal_shadow_ci`）：ok，100/100 matched，unexpected 0
- `scripts/prisma-invariant-inventory.test.ts`：通過；model 151、migration 目錄 116，與文件一致
- 未執行：完整 `npm test`、coverage 門檻、`test:db:concurrency`（`actions.payout-db.test.ts`）、e2e。CI `quality` 尚待確認。

需修正後再審
