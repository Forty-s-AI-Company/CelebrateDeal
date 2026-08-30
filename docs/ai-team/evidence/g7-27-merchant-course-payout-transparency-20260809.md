# G7-27 Merchant Course F/G payout transparency checkpoint

日期：2026-08-09

狀態：`ACCEPTED_LOCAL`。商家財務角色現在可從主導覽進入自己的課程分潤清單，並查看 Course F/G allocation、gross/net/payable、退款／爭議帳本及 payout outcome。所有查詢都綁定目前 vendor；跨 tenant 或不存在的 payout detail 會回到 `notFound()`，頁面不提供 payout mutation。

## 產品修正

- 主導覽新增「課程分潤」，讓商家不必依賴平台管理員查詢 Course F/G 撥款。
- 清單顯示月份、收款人、gross、net、payable、狀態、付款或失敗原因及 detail 入口。
- Detail 顯示產品、訂單、角色、share、gross allocation 與 policy snapshot。
- Ledger 顯示 entry type、金額、provider、event identity、dispute case 與建立時間，可追蹤 refund/dispute 對撥款的影響。
- 對帳總額使用完整 tenant/recipient/month scope aggregate；畫面即使只顯示前 250 筆 allocations，仍不會因截斷產生假的 mismatch，且會顯示截斷提示。
- Ledger detail 顯示上限為 500 筆並提供提示；完整 balance 仍由資料庫 aggregate 計算。
- 保留 loading route、空狀態、表格可橫向捲動與語意化欄位。

## 權限與資料邊界

- List 與 detail 都經過 `requireVendorFinance`。
- Payout detail 使用 `{ id, vendorId }` 查詢，阻止 direct URL 跨 vendor 讀取。
- Allocation、ledger detail 與完整 ledger aggregate 都含 `vendorId`，並綁定 payout recipient 與月份。
- 商家頁只有 read model，不包含 approve、retry、mark paid 或其他平台財務操作。
- React 預設 escaping；route parameter 使用 `encodeURIComponent`。

## Fresh deterministic evidence

- 最終 UTC：`2026-08-09T05:56:42.9405486Z`
- `npm test -- --run src/components/app-shell.test.ts src/app/(app)/billing/course-payouts/page.test.tsx src/app/(app)/billing/course-payouts/[id]/page.test.tsx`：`18/18 PASS`，failed=`0`、exit code=`0`。
- `npm test -- --run src/app/actions/support-case-actions.test.ts`：`6/6 PASS`，failed=`0`、exit code=`0`。
- Scoped ESLint：PASS，exit code=`0`。
- Full `npm run typecheck`：PASS，exit code=`0`。
- 本 WP 沒有執行 Browser、staging、Sandbox 或 Production 操作；不把未執行項目標示為 PASS。

## 關鍵測試範圍

- 主導覽只有具財務權限角色可看到課程分潤入口。
- List 查詢綁定 vendor，顯示 gross/net/payable、成功 reference 與失敗原因。
- Detail 查詢綁定 payout id 與 vendor id，跨 tenant 使用 `notFound()`。
- 無效月份 fail closed。
- Course F/G allocation、policy snapshot、refund 與 dispute ledger 可見。
- `disputeCaseId` 可見。
- 251 筆 allocation 時顯示截斷提示，並使用完整 aggregate 正確對帳。

## Reviewer

- 第一輪：`NO_P0_P1`，找到 2 個 P2，分別為 allocation 超過 250 筆時可能產生假 mismatch，以及 dispute case identity 不可見。
- 修正後由同一 reviewer 唯讀複核：兩項均 `RESOLVED`，`NO_NEW_P0_P1`。
- Reviewer 實際重跑 targeted tests：3 test files、18 tests 全部 PASS。

## Source digests

- `ADD3E7324BD7C18ED7F49A1C63F0240040CA210EB8C9CDEB54C3331099B527F6  src/components/app-shell.tsx`
- `FBDA569A19B799BB638723DB7AE07D70038248DBC53D6C9498E1F606F1B35E54  src/components/app-shell.test.ts`
- `9937F152EEA8BF2CF4D0027ED504E5B8569AEA61E8854C276AEB1791156C107A  src/app/(app)/billing/course-payouts/page.tsx`
- `6EF4A3F63C421A82AF19C24ADA2ADFB238E13FACF5E8C13228627D076F8D949F  src/app/(app)/billing/course-payouts/page.test.tsx`
- `3C8ECE2C8EA8CB20D8DFA657C9964F66BB9A11D9368F6C139B8D7FB3958ABF8E  src/app/(app)/billing/course-payouts/[id]/page.tsx`
- `F050A2272E4A02A5BEE3FC3503D143A886B1F978332ACCB42B38EA2D21E7C9ED  src/app/(app)/billing/course-payouts/[id]/page.test.tsx`

## 分數判斷

- 固定功能 `聯盟／課程／settlement／payout`：`7.5 → 8.0`。
- 提升來源：商家可直接完成 Course F/G 撥款查詢與精確對帳，補足原本只有平台管理後台、商家無法自助追蹤的產品缺口。
- Latest canonical total 維持 `74.0`。本地商家財務 read model 不能代替 CAT04 PayUni Sandbox/staging，也不能代替 CAT10 真人簽核。
- CAT04/CAT10 持續跳過，不阻擋可自動推進的功能工作。
- 沒有重跑 FIN-08AA、WP-196、WP-197 的 terminal endpoint、probe 或失敗命令。

## 回滾範圍

- 移除兩個商家課程分潤 route、對應 tests 與 AppShell 導覽項目即可。
- 沒有 schema、migration、資料寫入或外部服務副作用。

## 下一個最高價值工作

補齊商家聯盟 commission 的逐筆 ledger、退款／爭議與 payout detail，讓 affiliate 與 Course F/G 都有一致的自助財務追蹤能力。
