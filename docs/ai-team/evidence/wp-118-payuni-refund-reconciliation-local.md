# WP-118 — PayUni Sandbox 終態退款對帳（LOCAL stage）

日期：2026-08-02（Asia/Taipei）  
結果：`LOCAL_ACCEPTED`（Sol High `ACCEPT`）；尚未執行 Sandbox query、staging DB 寫入或部署；CAT04 維持 **6.0/10**。

## 本包範圍

- 新增 PayUni provider query 的最小型別契約與 Sandbox-only adapter。
- 查詢固定使用官方 SDK 所示的 `POST /api/trade/query`、Version `2.0`、`MerTradeNo`，並驗證 `EncryptInfo` / `HashInfo`。
- 只接受已驗證的 `SUCCESS`、相同訂單／交易序號／原始金額與明確 `RefundStatus`；未知狀態、缺退款金額、簽章錯誤、Production 環境與金額不一致均 fail closed。
- 新增 `/admin/billing/refund-reconciliation/[id]` 平台財務頁。Server Action 重新驗證 finance-admin、Origin、CSRF 與交易資料；本機已是 refunded 且無 pending reservation 時，在 provider query 前直接 no-op。
- 對帳只接受唯一 `request:<32 hex>` pending reservation，且本機狀態必須是 `paid` 或 `partially_refunded`；在同一個 Serializable transaction 內將其轉為 processed、寫入穩定 hash-based reconciliation identity、更新 `PaymentTransaction` 終態並建立單一稽核紀錄；不會重送退款。

## Deterministic evidence

- `npm run test -- src/lib/payment-providers/payuni.test.ts src/lib/payuni-refund-reconciliation.test.ts`：38 passed、0 failed、0 skipped。
- 付款／退款／webhook 回歸範圍：4 files、154 passed、0 failed、0 skipped。
- `node --import tsx scripts/wp118-refund-reconciliation-disposable.mjs`：13 個 canonical PostgreSQL migrations、synthetic marker-owned `wp118_*` schema；success reconciliation、invalid-state zero-write、Serializable rollback、duplicate no-op single-audit 與 marker cleanup 全部 PASS。
- AGY Fast remediation QA：兩次 timeout，保存為 `TOOL_BLOCKED`；不取代 deterministic evidence，也沒有任何外部副作用。
- scoped ESLint：PASS。
- `npm run typecheck`：PASS。
- `git diff --check`：PASS；staged index：empty。
- 既有完整 `npm run test` 仍被既有 PRESERVE_ONLY 範圍阻擋：shared DB 缺 `AffiliateCommission.deduplicationKey`／ledger schema、WP-116 舊 snapshot contract 與缺少 WP17/WP18 disposable env；這些失敗未被本包修改或隱藏。

## Ownership / rollback

新 owned paths：

- `src/lib/payment-providers/types.ts`
- `src/lib/payment-providers/payuni.ts`
- `src/lib/payment-providers/payuni.test.ts`
- `src/lib/payuni-refund-reconciliation.ts`
- `src/lib/payuni-refund-reconciliation.test.ts`
- `src/app/admin/billing/refund-reconciliation/[id]/page.tsx`
- `scripts/wp118-refund-reconciliation-disposable.mjs`

既有 dirty paths、WP-106/107/113 runner、dashboard、actions、webhook route 與歷史 receipt 均 `PRESERVE_ONLY`，未修改。Rollback 可只移除上述新增對帳頁／service／tests，並將兩個 clean provider 檔案恢復至本 WP 前的精確 hunk；不需要 reset、clean、stash、checkout 或丟棄其他變更。

## 尚未宣稱的項目

- 沒有 PayUni Sandbox provider-query receipt。
- 沒有 staging DB reconciliation receipt。
- 沒有 duplicate provider-query no-op 的線上 receipt。
- 沒有部署、DNS、Production、正式資料庫、付款、退款、callback replay 或 `.env*` 存取。
- CAT04 不加分；WP-117 的 local reconciliation mismatch 仍未關閉。
- Sol High 已對本機範圍給出 `ACCEPT`；這不是 live Sandbox、staging reconciliation、`SANDBOX_READY` 或 `PRODUCTION_READY`。

## 下一個外部前置條件

需另行明確授權一次官方 PayUni Sandbox provider query、一次 staging DB reconciliation transaction，以及必要的完整 workspace Preview/staging deployment。若 host 不是 `sandbox-api.payuni.com.tw`、部署路由不明、query response 缺可驗證欄位、或 staging transaction 非唯一可辨識，立即停止且不寫入。
