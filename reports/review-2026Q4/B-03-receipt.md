# B-03 收據：金流與財務審查

- 基線：`review-baseline-2026Q4` = `78621ca32cabfc016a69504c996c107785987cc2`（分支 `codex/goal-review-2026q4`）
- 執行者：獨立 reviewer 子代理（Opus，唯讀）；日期 2026-10-19
- 產出：`docs/review-2026Q4/13-payments-finance.md`（由主對話依 reviewer 回報原文寫入；reviewer 不寫檔）
- 結果：BLOCKER 3（B03-01～03）、MAJOR 6（B03-04～09）、MINOR 13、NIT 2

## 已執行
- `npx vitest run src/lib/payment-providers/payuni.test.ts src/lib/payment-providers/payuni-setup.test.ts src/lib/payment-webhook-invariants.test.ts src/app/api/webhooks/payments/route.test.ts src/lib/payment-method-setup.test.ts src/lib/payuni-refund-execution.test.ts src/lib/payuni-refund-reconciliation.test.ts src/app/api/webhooks/payment-methods/route.test.ts` → 8 個檔案、233 項全部通過。
- 探針（放在 session scratchpad，repo 外，沒有修改 repo）：`scratchpad/b03/payuni-normalize.test.ts`，以合成金鑰簽出真實格式的 UPP 回呼，使用 `--config <repo>/vitest.config.ts --root <scratchpad>` 執行，6 項通過。輸出：TradeStatus 1/0/2/3/4/9 的 `eventType` 全部是 `"paid"`，`netAmountCents=0`、`gatewayFeeCents=0`。這是 B03-01、B03-04 的證據。

## 沒有執行
- 任何 `*.db.test.ts`、checkout route 測試（需要 PostgreSQL）；`npm run typecheck`、`npm run lint`（審查沒有改程式）。
- 沒有呼叫外部服務，沒有讀 `.env*`，沒有 git 寫入，沒有修改 repo 檔案。

## 主要證據位置
- B03-01：`src/lib/payment-providers/payuni.ts:959-1002`、`876-884`
- B03-02：`src/lib/billing.ts:203-209`、`294`；`src/lib/platform-plan-checkout.ts:412-420`；`src/app/actions/invoice-actions.ts:165-178`
- B03-03：`src/app/admin/billing/dashboard/page.tsx:173`；`src/app/actions.ts:2146`；`src/lib/billing-cycle.ts:116`；`src/lib/billing.ts:295`
- B03-04～09：見 findings 表的「檔案:行號」欄。
