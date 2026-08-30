# FIN-12 — Shared refund accounting closure

日期：2026-08-07  
結果：`COMPLETE_LOCAL_FUNCTIONAL_FIX`；外部 staging／PayUni／人工 release evidence 仍未完成。

## 修正

- finance-admin 本地退款與 PayUni completion 現在會和 `RefundRecord`、`PaymentTransaction` 在同一個 Serializable transaction 內寫入 affiliate 與課程 F/G payable refund ledger。
- provider event 可用時使用 provider event identity；本地退款使用不可變的 `RefundRecord` identity，避免重試重複沖銷。
- affiliate 退款只接受既存訂單號碼的嚴格歸屬；缺少訂單號碼時 fail closed，不猜測佣金。
- 課程退款沿用 immutable allocation snapshot 與 exact-cent 分配；既有 webhook 也改用同一個共用 helper。
- 任一 ledger accounting 失敗時，退款紀錄與付款狀態一併 rollback；PayUni 已成功但本地 completion 失敗時保留可恢復的 pending reservation。

## 可追溯驗收結果

- targeted action／webhook／course cohort：3 files，187 passed，0 failed，0 skipped。
- full Vitest：170 files，1259 passed，0 failed，0 skipped。
- Node contracts：620/620 passed。
- architecture／Prisma inventory／payout schema contracts：3 files，8/8 passed。
- `tsc --noEmit`、scoped ESLint、`git diff --check`：PASS。
- `npm run release:verify:local`：`verified`。
- loopback disposable PostgreSQL：15 migrations，`No pending migrations to apply.`

## 邊界與評分

本包沒有執行 staging、PayUni Sandbox、Production、正式付款／退款或寄信，也沒有讀取 `.env*`、Token、Cookie 或 Secret。CAT04 仍為 6.0、CAT06 7.0、CAT10 4.5、總分 73.5；本地功能修正不直接增加分數。FIN-08AA、WP-196、WP-197 均未重試，staged index 維持空白。

證據檔：`.ai-team/reports/fin12-refund-accounting-closure.json`。
