# FUNC-2026-08-07-27：Live resource tenant binding

驗證時間：2026-08-07 16:26（Asia/Taipei）  
狀態：`LOCAL_FUNCTIONAL_CLOSURE`，不是 staging、PayUni 或人工 release acceptance。

## 本輪實際修正

- `Video` 與 `RegistrationForm` 增加 `(vendorId, id)` 唯一 identity，供 Live 的 tenant-aware composite foreign key 使用。
- 新增 `20260808020000_live_resource_tenant_binding` migration：對既有非空 Live resource binding 先做 missing-parent／cross-vendor preflight；通過後建立 composite FK。
- 保留既有 nullable `videoId`／`formId` 單欄 `ON DELETE SET NULL` 行為，並以 composite `NO ACTION` FK 阻止直接資料庫 bypass 造成跨商家綁定。
- migration 不含 `DELETE`、`TRUNCATE` 或 `DROP TABLE`；只在 disposable PostgreSQL 驗證，不套用 production。

## 實際驗證

| 檢查 | 實際結果 |
|---|---|
| `npx prisma validate` | PASS |
| `npx prisma generate` | PASS |
| targeted Prisma／tenant contract | 2 files、4 tests PASS；0 failed、0 skipped |
| full Vitest | 197 files、1388 tests PASS；0 failed、0 skipped |
| Node contracts | 679 tests PASS；0 failed、0 skipped |
| `npm run typecheck` | PASS |
| scoped ESLint | 0 errors、0 warnings in FUNC-27 files |
| `npm run secret:scan` | `secret_scan_passed` |
| disposable PostgreSQL semantic runner | 25/25 migration validate/deploy/status PASS；valid binding PASS；cross-vendor Video rejection PASS；cross-vendor Form rejection PASS；delete preserves `SET NULL` PASS |
| sanitized runner receipt | `.ai-team/reports/func-2026-08-07-27-live-resource-tenant-disposable.json` |
| cleanup | exact disposable container、temporary root PASS；無殘留 `celebratedeal-wp27-*` container |

## 分數與外部邊界

本輪 current score change 為 `0`，canonical total 仍為 `73.5`：CAT04 `6.0`、CAT10 `4.5`。本輪關閉的是本機 DB-I07 tenant-integrity residual，不能替代：

- CAT04 的 fresh staging reconciliation、PayUni Sandbox provider receipt 與 payout/refund reconciliation external evidence。
- CAT10 的真人 merchant、客服 SLA、法務／隱私／退款、財務、release owner 與 external monitoring evidence。

本輪未執行 staging、PayUni、Production、正式付款／退款／寄信、部署、push、merge 或 terminal no-go retry；未讀取 secrets、production data 或 raw payment data；未降低 coverage threshold、inventory、exclude、skip 或 assertion。最新 authoritative coverage 仍為 QUAL-19：40.73／46.56／49.25／61.16 對 63／57／60／65，coverage gate 仍 OPEN，沒有拿 coverage 取代產品 closure。

## 回滾與下一步

回滾只可依 FUNC-27 ownership 做 inverse patch；不得使用 reset、restore、clean、stash、checkout 或整檔覆蓋既有 dirty worktree。disposable migration 僅作用於 loopback PostgreSQL，container 與 temporary root 已清理。

下一個最高產品價值本機工作是 stream usage attribution allocation：補齊 `PROMOTER`／`OWNER`／`SPLIT`／`CUSTOM` policy、raw usage ledger 與內部 allocation read model 的 atomic/idempotent closure。這仍不能預先宣稱 CAT01 加分；分數只在新的可追溯驗收 evidence 被 canonical reconciliation 接受後更新。
