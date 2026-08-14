# G7-28 Merchant affiliate payout transparency checkpoint

日期：2026-08-09

狀態：`ACCEPTED_LOCAL`。商家財務角色現在可從聯盟佣金清單查看每筆 affiliate payout 的 gross／net snapshot、佣金來源、退款／爭議帳本、付款 reference 及成功或作廢原因。所有讀取都綁定目前 vendor；頁面不提供 payout mutation。

## 產品修正

- 聯盟佣金清單將 commission 與 payout 空狀態分開，即使該月份沒有佣金列，既有 payout 仍可見。
- 新增 payout detail，顯示 affiliate、月份、gross sales、net reference、commission、狀態、付款 reference、結果原因及付款時間。
- Detail 顯示每筆 commission 的訂單／推薦來源、原始佣金、完整 ledger balance 與 payout snapshot。
- Ledger 顯示 entry type、金額、provider、event identity 與 dispute case，可追蹤 refund／dispute 對 payout 的影響。
- 對帳總額使用完整 vendor／affiliate／month scope aggregate；畫面只顯示前 250 筆 commission、每筆前 500 筆 ledger 時會清楚提示，截斷不會造成假的 aggregate mismatch。
- Settlement lock 建立 payout 時保存 gross sales 與 net reference snapshot；既有非空 snapshot 若與當前 ledger 不符會 fail closed。
- Payout 成功或作廢時保存清理後的 outcome reason，供商家自助查詢。
- Migration 允許歷史資料維持 `NULL`，新原因若為空白或超過 500 字元則由資料庫拒絕。

## 權限與資料邊界

- List 與 detail 都經過 `requireVendorFinance`。
- Payout detail 使用 `{ id, vendorId }` 查詢，阻止 direct URL 跨 vendor 讀取。
- Commission、ledger detail 與完整 aggregate 都綁定 `vendorId`、affiliate 與月份。
- 商家頁只有 read model，不含 approve、retry、mark paid、void 或其他平台財務操作。
- 無效月份 fail closed；React 預設 escaping，route parameter 使用 `encodeURIComponent`。

## Fresh deterministic evidence

- 最終 UTC：`2026-08-09T06:27:50.4051757Z`
- Targeted Vitest：4 files、`221/221 PASS`，failed=`0`。
- `src/app/actions.test.ts`：`207/207 PASS`，failed=`0`。
- Scoped ESLint：PASS。
- Full `npm run typecheck`：PASS。
- Prisma generate：PASS。
- Prisma validate：PASS。
- G7-28 disposable PostgreSQL：48 migrations、4/4 contract assertions PASS，container 與 temp cleanup PASS。
- Finance DB-backed integration：48 migrations、`5/5 PASS`，failed=`0`、skipped=`0`，container 與 temp cleanup PASS。
- Sanitized receipts：`.ai-team/reports/g7-28-affiliate-payout-transparency-disposable.json` 與 `.ai-team/reports/g7-01-finance-disposable-20260808.json`。
- 本 WP 沒有執行 Browser、staging、PayUni Sandbox 或 Production 操作；不把未執行項目標示為 PASS。

## 關鍵驗收範圍

- Settlement lock 依完整 commission ledger 建立 gross、net 與 payable snapshot。
- 同一 payout 已有非空 snapshot 且內容不一致時拒絕繼續。
- Payout paid／void outcome reason 可持久化並由商家頁讀取。
- 空白與超長 outcome reason 由實際 PostgreSQL constraint 拒絕，歷史 `NULL` 相容。
- Detail 查詢綁定 payout id 與 vendor id，跨 tenant 使用 `notFound()`。
- Refund／dispute ledger、event identity、provider 與 dispute case 可見。
- 超過 250 筆 commission 時仍以完整資料庫 aggregate 對帳，並顯示截斷提示。

## Reviewer

- Reviewer 結論：`NO_P0_P1`，沒有確認的 P2。
- Reviewer 覆核 tenant／IDOR、snapshot 計算、refund／void／paid reconciliation、截斷 aggregate、outcome reason 與 migration contract。
- Reviewer 當時重跑 4 files、220 tests 全部 PASS；主代理補上最後一筆 regression 後重跑為 221/221 PASS。
- Reviewer 提醒 DB-backed outcome reason 證據不足後，已補入 finance disposable integration，實際結果 5/5 PASS。

## Source digests

- `669E4752478B78DF4B101FE688969C3203E4F62351706A8137C9FA243B7F7363  prisma/schema.prisma`
- `560602078220B86DEBE3A3B2392375EB1ADB9D651426629B86771F7DAE66FC8A  prisma/migrations/20260809060000_g7_28_affiliate_payout_outcome_reason/migration.sql`
- `678DB81A150A6281B3E5B3604D782A57B4CA35FB1F34F9096973B8939C391F8B  src/app/actions.ts`
- `DB815F46A8FD684E194C9A51D7FF201686596B466F86F06F5D6DA411329EA82A  src/app/actions.test.ts`
- `BF5A87FE84D67462755B04FE36C9234D2A84FE709721A3D67DF5945AD1DE5113  src/app/actions.payout-db.test.ts`
- `856FE79713A375AC220E512AB0B63F707A8FB1FFDFD23CF2BD1FF1C040C5F1B2  src/app/(app)/affiliates/commissions/page.tsx`
- `F29FF31D3A273759A5D857A4DD47504A701E0F41FDEB0C7DBD41309DB615508B  src/app/(app)/affiliates/commissions/page.test.tsx`
- `DA9AA84FA0EDA851B19E94FA11681BE5608AB6ACA2DA3648A94B79A72F1DBC09  src/app/(app)/affiliates/commissions/[id]/page.tsx`
- `DC2464FC2A3B5AF18BD65751A66192743BAD70B03E5F237F3CD8E712AFD56572  src/app/(app)/affiliates/commissions/[id]/page.test.tsx`
- `FFCE292A2E5D8EEA3B688372471894093D2046B0E39FF112F3BA6656C67EC16A  src/lib/affiliate-payout-schema-contract.test.ts`
- `982526BC2A6EA6ECBA00E5EE7ED953C4C548199490741274BAD4A96FD2EEB9F0  scripts/g7-affiliate-payout-transparency-disposable-qa.mjs`
- `449BC354DE605C68E17FC854957121E2057E13AA6989F2AC85619345955F16BA  .ai-team/reports/g7-28-affiliate-payout-transparency-disposable.json`
- `74A1E9A87E35CB6972279BAD1EEF8EF29ABE1DD90BC49CFC49E9C0802C8F4201  .ai-team/reports/g7-01-finance-disposable-20260808.json`

## 分數判斷

- 固定功能 `聯盟／課程／settlement／payout`：`8.0 → 8.4`。
- 提升來源：商家可直接完成 affiliate payout 查詢與精確對帳，且 settlement snapshot、結果原因及資料庫約束都有 fresh deterministic evidence。
- Latest canonical total 維持 `74.0`。本機商家財務能力不能代替 CAT04 PayUni Sandbox／staging，也不能代替 CAT10 真人簽核與外部監控交付。
- CAT04／CAT10 持續列為 blocker，但不阻擋其他可自動推進的產品功能。
- 沒有重跑 FIN-08AA、WP-196、WP-197 的 terminal endpoint、probe 或失敗命令。

## 回滾範圍

- 可移除 affiliate payout detail route、清單入口、相關 tests 與 QA runner。
- `outcomeReason` 為 additive nullable schema。若 migration 已套用且已有資料，應以新的 forward migration 回滾欄位，避免直接破壞 migration history。
- Settlement snapshot 與 outcome reason 寫入只發生在既有財務動作內；本次驗證僅使用 disposable synthetic fixtures，沒有外部副作用。

## 下一個最高價值工作

盤點並補強「銷售型直播」的發布前 readiness：讓商家在發布前直接看到商品、報名表、Email、互動腳本與媒體缺口，保留純講座／非銷售直播的合理流程，避免已上線卻無法完成導購。
