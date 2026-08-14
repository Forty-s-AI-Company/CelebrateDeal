# G7-26 Split partial refund support handoff checkpoint

日期：2026-08-09

狀態：`ACCEPTED_LOCAL`。本輪修正實際退款已由多筆 partial refunds 完成，但客服退款 handoff 只能接受一筆等額退款、因此無法結案的 P1。現在財務可明確選擇一筆或多筆 canonical refunds；server 與 PostgreSQL 都要求同 tenant、同訂單、同 payment transaction、`processed`、未被其他 handoff 使用，且合計精確等於申請金額。

## 產品修正

- 新增 `SupportRefundHandoffRefund`，逐筆保存 handoff 與 canonical refund 的 immutable 關聯及金額 snapshot。
- 每一筆 refund 只能被一個 handoff 認領，避免同一退款重複結案。
- Server Action 接受最多 50 筆合法且不重複的 refund ID；舊版單筆 `completedRefundId` request 仍可相容。
- Domain 重新讀取 tenant/order/payment transaction/status/amount，驗證所選總額後才在同一 serializable transaction 建立 links、完成 handoff、解決客服案件並寫入兩份 append-only event。
- 財務頁改為多選 processed refunds，動態顯示已選筆數與總額；金額未精確相等時完成按鈕維持 disabled，並保留 pending、防重送、`aria-live` 與 error feedback。
- 完成後頁面列出每一筆已綁定 refund evidence，保留 provider、event reference 與金額。

## Migration 與 DB invariants

- 完整 canonical migration chain：47/47 migrations PASS。
- 合法舊單筆 completion 會 backfill 成一筆 link。
- 舊 completion 若 refund 不存在、非 processed、金額不同或 payment transaction 不同，migration 直接 fail closed。
- Link 禁止 UPDATE 與 DELETE；FK 對 handoff 使用 RESTRICT。
- 已被 handoff 採用的 `CommerceOrderRefund` 禁止變更 tenant、order、id、payment transaction、amount 或 status。
- Handoff 進入 completed 時，DB trigger 再次驗證 link 數量、總額、processed 狀態、payment transaction 與 anchor membership。

## Fresh deterministic evidence

- 最終 UTC：`2026-08-09T05:44:00.8549583Z`
- `npm test -- --run src/lib/support-case-domain.test.ts src/app/actions/support-case-actions.test.ts src/app/admin/support-cases/page.test.tsx`：`19/19 PASS`，failed=`0`、skipped=`0`、exit code=`0`。
- Scoped ESLint：PASS，exit code=`0`。
- Full `npm run typecheck`：PASS，exit code=`0`。
- `npx prisma validate --schema prisma/schema.prisma`：PASS，exit code=`0`。
- `node scripts/prisma-loopback-disposable-migration-runner.mjs`：47 migrations，validate/deploy/status/cleanup 全部 PASS，exit code=`0`。
- `node scripts/g7-split-refund-handoff-disposable-qa.mjs`：11/11 assertions PASS，exit code=`0`。
- Disposable receipt：`.ai-team/reports/g7-26-split-refund-handoff-disposable.json`。
- Receipt SHA-256：`A99464A35029E557D8B8C5843E6AD7A0BDF663B1C9972249718358A73C41CD27`。
- 所有 DB fixtures 都是 synthetic；loopback-only、tmpfs、零 Production side effect，container 與 temp root cleanup 均為 PASS。

11 個 DB assertions：

- `split_sum_accepted=true`
- `split_links_preserved=true`
- `incomplete_sum_rejected=true`
- `refund_reuse_rejected=true`
- `pending_refund_rejected=true`
- `other_payment_rejected=true`
- `snapshot_mismatch_rejected=true`
- `completion_link_immutable=true`
- `completion_link_delete_rejected=true`
- `linked_refund_update_rejected=true`
- `legacy_payment_mismatch_backfill_rejected=true`

## Reviewer

- 第一輪：`NO_P0`，找到 2 P1 與 1 P2，分別是 link 可刪除、legacy wrong-payment backfill 與 linked canonical refund 可修改。
- 三項都已修正並加入 disposable regression assertions。
- 第二輪同一 reviewer：三項 `RESOLVED`，`NO_NEW_P0_P1`。Reviewer 維持唯讀，沒有改檔或執行外部操作。

## Source digests

- `0139AFA397957ADC4595A77055DE610DF905B3BA47697D880E8B5A25B45B5EAB  prisma/schema.prisma`
- `6BD8A58FAB97E2148D4EE7A2D201A2D90D8DAC304FD9CC0755CBCC7B1F5BF6BD  prisma/migrations/20260809050000_g7_26_split_refund_handoff/migration.sql`
- `77A69B49E92E484539F534561689FF49B85D9223D5A0471EB3488384F2A83F19  src/lib/support-case-domain.ts`
- `13D435BEE818EF53282AD655A31A548EFDB590ED559DB1B5378E83CC62E4C599  src/lib/support-case-domain.test.ts`
- `F8560B60F9F198C32BBEF1AF46568518EECAD2713423B0E73B7B1AA3C021B28F  src/app/actions/support-case-actions.ts`
- `46425C589B9EBC8CF328BD3FA0C94D0740ECA5371C62347A7D9755CC0A9C333A  src/app/actions/support-case-actions.test.ts`
- `ED2BEB018BE2551916B6EE7E3CE61BB44E32B3A9355C642161F288FA87DB7445  src/app/admin/support-cases/[id]/page.tsx`
- `F236100EB16248559935A410B259C1FBF91734797533C0E587CA74F77C43DCB5  src/components/support-refund-selection.tsx`
- `DC5C6DA0A310C790EB8962A8A2E605F2DFD8971E9479ED9DAC0BA3E9BC090413  scripts/g7-split-refund-handoff-disposable-qa.mjs`

## 分數判斷

- 固定功能 `退款／客服` 維持 `8.0/10`。舊 scorecard 已給 8.0，本輪修正 review 新發現的 P1 並換成更強的 fresh evidence，不重複加分。
- Latest canonical total 維持 `74.0`。本地退款功能 evidence 不能代替 CAT04 PayUni Sandbox/staging，也不能代替 CAT10 真人法律、財務、客服 SLA、monitoring 與 release acceptance。
- 沒有重跑 FIN-08AA、WP-196、WP-197 的 terminal endpoint、probe 或失敗命令。

## 回滾範圍

- 新增 additive migration 與 `SupportRefundHandoffRefund` Prisma model。
- 退款 handoff domain、Server Action、多選 UI、財務 detail query 與 tests。
- Disposable DB QA runner 與本 checkpoint artifacts。
- 回滾不得直接刪除已產生的 completion links；有資料後必須另做經核准的 forward migration。

## 下一個最高價值工作

維持 CAT04/CAT10 blocker 跳過。處理固定功能最低的 `聯盟／課程／settlement／payout 7.5`，先補商家財務看不到 Course F/G gross、net、refund/dispute ledger 與 payout outcome 的產品缺口。

## 追補驗證

- `2026-08-09T05:56:42.9405486Z`：將已驗證退款 ID 明確窄化為 `string[]`，不改動 runtime validation 或 assertion。
- `npm test -- --run src/app/actions/support-case-actions.test.ts`：`6/6 PASS`。
- Scoped ESLint 與完整 `npm run typecheck`：PASS。
- 上方 `support-case-actions.ts` digest 已更新；其餘 G7-26 source digest 與 DB evidence 未變。
