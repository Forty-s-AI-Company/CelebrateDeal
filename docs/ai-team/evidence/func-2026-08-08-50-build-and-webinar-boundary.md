# FUNC-2026-08-08-50｜Production build blocker 與 webinar ownership boundary

## 結果

`COMPLETE_LOCAL_PRODUCT_FIX_NO_SCORE_CHANGE`。本輪先處理真正會阻止販售功能上線的 production build blocker，再以隔離 PostgreSQL 與 production-like Next server 驗證 webinar ownership boundary。

## 產品修正

- `src/app/actions.ts` 原本直接 re-export affiliate Server Action；Next.js 16 的 file-level `use server` module 只接受直接的 async function export，導致整站 build 失敗並連帶讓 MFA、直播、結算與其他 action import 全部不可用。
- 改為在根 action module 內以直接 async wrapper 暴露 `voidAffiliateCommissionAction`，保留既有 import path 與 affiliate 業務邏輯，不放寬任何授權或 assertion。
- 既有 webinar server-side predicate 維持：選定 webinar 必須同 vendor/team，且 `seminarOwner` 必須是目前 actor 的 active team membership；ownership 不以瀏覽器 select 選項作為信任來源。

## 驗證

- `npx next build`：PASS；Turbopack compile、TypeScript、88 static pages、route optimization 全部完成。
- `npx vitest run src/app/actions/affiliate-actions.test.ts`：5/5 PASS。
- `npx vitest run src/app/actions/team-funnel-template-actions.test.ts`：6/6 PASS。
- isolated Chromium E2E：`tests/e2e/team-template-foreign-webinar-publish-boundary.spec.ts`，1/1 PASS。測試以 member A 登入，將 member B 的 webinar 注入表單後送出發布；server 拒絕，且 template、version、source page 與兩個 webinar 的資料 snapshot 維持不變。
- `npm run typecheck`：PASS；scoped ESLint：PASS；`git diff --check`：PASS。

## Disposable database 與阻擋紀錄

- Playwright 使用的 `localhost:54329/celebratedeal_test` 只缺 `20260808060000_payment_method_reference`；該單一 pending migration 已成功套用，沒有 reset、drop、seed 或正式資料操作。
- 首次 E2E 因 test DB 缺 table 曾出現 P2021；補齊 disposable schema 後重新執行，1/1 PASS 且沒有該 schema error。
- 中途一個 datasource routing 誤落到本機 `celebratedeal_dev` 的 migration deploy 因歷史 migration drift 在 `20260725112500_harden_tenant_ledger_foreign_keys` 失敗；沒有執行 `migrate resolve`、reset 或重試。後續唯讀 status 顯示 dev DB 為既有 migration history drift，未將此路徑算作成功 evidence。

## 分數與邊界

canonical readiness 維持 73.5：CAT01=7.5、CAT02=8.0、CAT03=8.0、CAT04=6.0、CAT05=8.5、CAT06=7.0、CAT07=9.0、CAT08=7.5、CAT09=7.5、CAT10=4.5；`current_goal_score_change=0`。CAT04 仍缺官方 PayUni setup／Sandbox receipt 與 staging reconciliation，CAT10 仍缺真人 owner 與外部 monitoring／release evidence，因此本輪不宣稱加分。

## 安全與回滾

- 未讀取或輸出 `.env*` 內容、credential、token、cookie、正式資料或付款資料。
- 沒有 production DB、正式付款／退款／寄信、staging、PayUni、部署、push 或 merge 操作。
- 沒有降低 coverage threshold、exclude、skip、assertion 或資料驗證強度。
- 產品回滾範圍為 `src/app/actions.ts` 的 affiliate async wrapper；保留其他使用者既有變更。

## 下一步

繼續處理能直接完善販售閉環的產品 source gap；CAT04 只在取得新的可追溯 PayUni Sandbox／staging evidence 後重算，CAT10 只接受真人 merchant、support、finance、legal/privacy/refund、monitoring 與 release owner acceptance。不得重跑 FIN-08AA、WP-196、WP-197 或既有 terminal external command。
