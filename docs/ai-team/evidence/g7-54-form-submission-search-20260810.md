# G7-54：報名名單查找、篩選與分頁

日期：2026-08-10（Asia/Taipei）  
狀態：`ACCEPTED_LOCAL_BROWSER_AND_DISPOSABLE_DB`  
Canonical readiness：維持 `75.5/100`；`CAT04=6.0`、`CAT10=4.5`

## 實際完成

- 報名名單新增姓名／Email／手機搜尋、驗證狀態與直播頁／獨立表單來源篩選。
- 搜尋使用具 CSRF 與登入商家 ownership 重查的 Server Action；聯絡資訊不放入 URL、query string 或 browser history。
- 每頁固定最多 25 筆，超出頁碼會依目前總筆數安全收斂；查詢只 select 畫面需要的欄位，不讀取 `answers`。
- 桌機使用名單表格，手機使用可讀卡片；包含 pending／disabled、防重送、live status、空結果與安全錯誤狀態。
- `/forms` 首頁改用 `_count` 與 verified `groupBy`，不再載入全部 submission rows 只為計數。
- 新增 PostgreSQL `pg_trgm` 與 name／Email／phone 三個 GIN trigram indexes，讓既有 case-insensitive contains query 可使用對應索引；canonical inventory 同步修正為 89 models／52 migrations。
- 實際 Browser 驗證發現 `name="reset"` 會遮蔽原生 `HTMLFormElement.reset()`，造成第二次 Server Action 後 `t.reset is not a function`。產品已改用 `resetFilters` 並補回歸測試；這是 production source 修正，不是放寬驗收。

## Ownership 與安全邊界

- 初始 route 與每次 Server Action 都從登入 session 重新取得 vendor；client 不提交 vendor id。
- form ownership 先以 `{ id, vendorId }` 驗證，submission query 再附 `form.vendorId` 防禦式 tenant scope。
- Search Action 先驗 CSRF，再驗 input 與登入商家；CSRF、無權限及 database error 都回傳固定安全訊息。
- 未讀取 `.env*`、正式 secret、Cookie 值、正式客戶資料或付款資料；Browser fixture 全為 disposable PostgreSQL synthetic data。

## 修改範圍

- `src/lib/form-submission-search.ts` 與測試
- `src/app/actions/form-submission-search-actions.ts` 與測試
- `src/components/form-submissions-workbench.tsx` 與測試
- `src/app/(app)/forms/[id]/submissions/page.tsx`、`loading.tsx` 與測試
- `src/app/(app)/forms/page.tsx` 與測試
- `scripts/g7-form-builder-browser-qa.mjs`、runner contract test
- `prisma/migrations/20260810051000_g7_54_form_submission_search_indexes/migration.sql`、search-index contract 與 Prisma inventory

## 驗證結果

### Deterministic

- 6 files／18 targeted tests：PASS。
- runner／search-index Node contracts：13/13 PASS。
- Prisma invariant inventory：89 models／52 migrations，PASS。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS。
- runner source safety、receipt validator、mirror exclusion、sanitizer、container ownership與 cleanup contract：PASS。

### Final disposable PostgreSQL／Browser receipt

- Receipt：`docs/ai-team/evidence/g7-54-form-submissions-browser-qa-f9ecdd7f7e025c5f.json`
- Receipt SHA-256：`34d61193df8cb6e92f735bb1a4267a1081aa2cd95b678cbac239f161a176439c`
- Production source digest：`5370c5604f0b6eec50f0e0f9675a7486e22abc92dd5014c01c9236a64aacc4f4`
- UTC：`2026-08-09T21:05:36.772Z` ～ `2026-08-09T21:08:16.005Z`
- Prisma generate／validate／52 committed migrations deploy／status：PASS。
- `next build --webpack` 與 loopback `next start`：PASS。
- Chromium：5/5 PASS、0 failed、0 skipped。
- 55 筆 synthetic rows，initial／filtered page size 最多 25；搜尋、驗證狀態、來源、reset、3 頁 pagination 與 URL privacy：PASS。
- Desktop 1440×1000、mobile 390×844、RWD：PASS。
- Axe critical／serious：0；keyboard、loading／disabled、CSRF error、cross-tenant noindex／no data leak：PASS。
- synthetic rows、server、owned tmpfs PostgreSQL container、temp root cleanup：全部 PASS。
- Desktop screenshot SHA-256：`0b5e6202ed55f9ea9c608175d26af89a4f25661ad3fdaa26efcb165851490932`。
- Mobile screenshot SHA-256：`f09b6784d3bf6634c149b0624fa18f2407f055522f9f04a9209deea6d86db597`。

先前 receipts 保留原狀，沒有改寫成最新 PASS；它們記錄 runner validator、locator、真實 form reset regression，以及 trigram index 前的 source lineage。只有上述 final receipt 涵蓋目前 52-migration source，具本 WP 計分資格。

## Reviewer

- Initial read-only reviewer：無 P0／P1；提出 tenant contract 命名與大型名單 index 兩個 P2。
- P2 修正後複查：`ELIGIBLE`。Reviewer 唯讀確認 streamed not-found contract 為 `noindex + no foreign canary`，三個 trigram indexes 與 contains query 一致，final receipt／sidecar／source digest／52-migration inventory／screenshots hashes 相符。

## 計分

- 固定功能 `registration_form_builder` 候選由 `8.7 → 9.1`：core `2.5 → 2.7`、fresh evidence `1.6 → 1.8`；recovery `1.8`、UX `1.8`、integrity/security `1.0` 維持。
- Canonical CAT 與總分維持 `75.5`。本輪是單一商家表單操作功能的本機／disposable evidence，不重複計入 CAT02／CAT06／CAT07；CAT04 與 CAT10 的外部／真人 blocker 不變。

## 未完成、回滾與下一步

- 未執行 staging、PayUni Sandbox、Production、正式資料、外部 Email、push、merge 或 deploy；沒有重試 FIN-08AA、WP-196、WP-197。
- 回滾範圍限於上述 G7-54 source／tests／runner／evidence。無 migration、Production data 或外部 side effect。
- 下一個最高產品價值工作：G7-55 Email merchant operations，盤點並補齊 delivery history、suppression／unsubscribe 可見性、失敗重試與收件者查找，持續跳過 CAT04／CAT10 blocker。
