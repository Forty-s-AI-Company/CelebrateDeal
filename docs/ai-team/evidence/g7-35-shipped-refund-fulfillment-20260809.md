# G7-35 已出貨全額退款履約修正證據

- Work Package：`G7-35`
- 驗證時間：`2026-08-09T09:48:17.9883429Z`
- 模式：`PRELAUNCH_DEV_AUTONOMOUS`
- Source aggregate SHA-256：`ce10a77669b2b1f77deca3cd1bb8feb716cfaa31ff68b0c6c04ac5bea79296d2`
- 結論：`LOCAL_PRODUCT_AND_DISPOSABLE_DB_PASS`

## 修正的產品問題

全額退款前若包裹已經出貨，舊流程會把訂單改成 `refunded`，物流仍停在 `shipped`。商家頁面會隱藏履約操作，server domain 也拒絕 refunded 訂單繼續更新，因此無法依真實物流結果結案。

本次新增明確 lifecycle：

1. 全額退款時，`pending`／`packing` 仍安全取消。
2. 已經 `shipped` 的項目改成 `refund_review`，保留 carrier、tracking 與 `shippedAt`。
3. 商家只能在 MFA tenant context 內，以 revision CAS 將 `refund_review` 結案為 `returned` 或 `delivered`。
4. `refund.processed.sanitizedData.fulfillmentConvergence` 記錄撤銷 entitlement、取消未出貨物流、待確認已出貨物流、取消服務的實際筆數。
5. `refundReviewAt`、`returnedAt` 與 DB constraints 保存狀態時間證據。

## 實際修改

- Prisma enum 新增 `refund_review`、`returned`。
- Prisma model 新增 `refundReviewAt`、`returnedAt`。
- 以兩段 additive migration 分離 PostgreSQL enum commit 與後續 constraint 使用。
- shipping state machine 新增 `refund_review -> returned | delivered`，其他 refunded shipping 狀態 fail closed。
- Server Action allowlist 新增 `returned`，vendorId 仍只取自 MFA context。
- 訂單頁在全額退款後仍顯示待物流確認操作，兩個動作皆有 pending、disabled 與 live pending message。
- 補 unit、action、server-rendered UI 與 disposable PostgreSQL integration tests。

## 驗證結果

| 驗證 | 結果 | 證據摘要 |
|---|---:|---|
| Targeted unit／action／UI | PASS | 5 files，31 tests passed，0 failed，0 skipped |
| Targeted ESLint | PASS | exit code 0，無輸出 |
| Full TypeScript typecheck | PASS | `tsc --noEmit`，exit code 0 |
| Controlled disposable PostgreSQL migration | PASS | loopback disposable DB，50 migrations applied；G7-35 兩段 migration 均成功 |
| CommerceOrder DB integration | PASS | 1 file，7 tests passed，0 failed，0 skipped |
| React checklist | PASS | server component 保持無 hooks／effect／client bundle；沒有新增 fetch、waterfall 或重複 request；表單沿用 Server Action 與既有 pending 元件 |
| Independent reviewer | RESOLVED | 唯讀複查未發現 P0／P1／P2；migration、state machine、tenant／MFA、audit counts、UI pending feedback 均通過 |
| Disposable cleanup | PASS | 精確 ownership label 驗證後移除 container 與匿名 volume；temporary Prisma／Vitest config 已刪除；無 residual container |

### 執行命令

```text
npx vitest run src/lib/commerce-order-domain.test.ts src/lib/commerce-orders.test.ts src/lib/commerce-order-fulfillment.test.ts src/app/actions/commerce-order-actions.test.ts src/components/commerce-order-detail.test.tsx
npx eslint <G7-35 scoped source and tests>
npm run typecheck
node node_modules/prisma/build/index.js migrate deploy --config <temporary-no-dotenv-config>
node node_modules/vitest/vitest.mjs run --config <temporary-envDir-false-config>
```

DB 與測試命令只使用合成 loopback URL、合成資料與暫時性 container；證據未保存 URL、密碼或原始資料。

## 失敗路徑與分類

第一次 migration 嘗試走到 repository 預設 `prisma.config.ts`，實際解析為既有 `localhost:54329`，因舊的 failed migration 回傳 `P3009`，exit code 1。該次沒有套用 G7-35 migration，不計入 PASS，也不分類成 schema drift，且沒有重跑同一命令。

後續改用 temporary no-dotenv Prisma config，明確連到本次 disposable container。預設 config 會執行既有 dotenv import，因此第一次失敗路徑不作為安全證據；沒有輸出或保存任何環境值。

第一次 DB test 使用不符合 local safety allowlist 的合成資料庫名稱，啟動前即以 `unsafe-database` 拒絕，沒有測試寫入。修正方式是保留安全閘，在同一個 scoped disposable container 建立 allowlisted `celebratedeal_test` 後重新 deploy 與驗證。

## Source SHA-256

```text
36998bf007fd2806ecec3aa9c5c89df13d802fa40b4cc7772866ff9195e0c447  prisma/schema.prisma
697a3e62608fb813481b2f62209b9c6131dc6f31f806018570284eca458a2b49  prisma/migrations/20260809070000_g7_35_shipping_refund_states/migration.sql
5d971c861df27657d99ae9102b232ab4c1aaf10cb8833740de1c7fe8e7f483ec  prisma/migrations/20260809071000_g7_35_shipping_refund_lifecycle/migration.sql
e87a8137befd7377c85add46ec8da837e6cf4d8259b2ec22d2e08e22a20946c5  src/lib/commerce-order-domain.ts
dad08c520ca2826f5be9f7ae663d3043a4ac5954d80c84ed0db9a633ee18f1dc  src/lib/commerce-order-fulfillment.ts
c141b9403b2a740472248faa216f250c58eb6da4a15142749860590372e61a6a  src/lib/commerce-orders.ts
7b10c8eef9e1915eece0e3b4a98749ae69928c759d9ddad91666a7e147f1f761  src/app/actions/commerce-order-actions.ts
b96c1ea78a7b03fb61ed292ba9b6e48cd8145307d15a7ca8e609674a7c784b15  src/components/commerce-order-detail.tsx
dc1fff96edcac40c8e49fbf8154d4556d48dc6ca900fd17ab83b15ab51e27440  src/lib/commerce-order-fulfillment.test.ts
0badef5d957fdac68159b50b1b3c999ea8a91c97cb4f304e8d8a22046520135b  src/lib/commerce-orders.test.ts
601d1c47a67a6ed04e4506ba59a8c21fef056b9509e62ae58b315452c1570e9b  src/app/actions/commerce-order-actions.test.ts
8b82142d7f412a27c9def5622349b5d7d09450fae2d5e2f295d1a3f2e31da561  src/components/commerce-order-detail.test.tsx
6be34309c366ffb28f7974a1f26a26b3ed09d37c2b415e6c69ba626b72276a8e  src/lib/commerce-orders.db.test.ts
```

## 安全與外部操作

- Production DB／付款／退款／寄信／deploy：`0`
- Staging／PayUni Sandbox／外部 provider：`0`
- 正式客戶或付款資料：`0`
- `.env` 值、Token、Cookie、Secret 輸出或保存：`0`
- Coverage threshold、assertion、exclude、skip 變更：`0`
- Git reset／clean／stash／restore／checkout／rebase：`0`

## 分數資格與回滾

- 固定功能 `orders_fulfillment` 可由 `8.0` 調整為 `8.5`：core `2.7`、recovery `1.7`、UX `1.5`、integrity/security `1.0`、fresh evidence `1.6`。
- canonical CAT 分數維持 `74.0`。本 WP 沒有 CAT04 外部 Sandbox 或 CAT10 真人證據，不虛增 canonical。
- 回滾範圍：G7-35 兩段 additive migration、上述 source 與 tests。已存在的 enum values 與 columns 不做破壞性自動 down migration；若停用功能，先回滾 application writes，再由真人核准資料 migration。

## 尚未完成

- CAT04 與 CAT10 blocker 未改變，繼續留在外部／人工路徑。
