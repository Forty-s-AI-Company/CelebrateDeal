# WP-85 — Value-first readiness score reconciliation and priority reset

日期：2026-07-30
模式：`PRELAUNCH_DEV`
範圍：僅對帳 score、evidence 與 backlog；不執行任何後續實作、產品測試、sandbox、production 或部署。

## 分數對帳

| 指標 | 已公布值 | 可重算結果 | 對帳狀態 | 結論 |
|---|---:|---:|---|---|
| 十分類明細 | `[7, 8, 6, 4, 5, 7, 9, 5, 5, 2]` | **58/100** | `SUFFICIENT` | 算術與 baseline 十列一致。 |
| Automatable Readiness | 63/100 | `57 + 2 + 2 + 1 + 1 = 63` | `UNPROVEN_LEGACY_DERIVATION` | 算式成立，但沒有能回填目前十類明細的逐類 mapping；不得稱為目前 scorecard 的可加總總分，也不得自行改成 58。 |
| Full Commercial Readiness | 45/100 | 不與前兩項混算 | `SEPARATE_SCALE` | 保留為獨立歷史指標，不能相加、平均或換算。 |

因此，本 Goal 的可稽核工作基線是十分類明細的 **58/100**；63 與 45 仍保留其原始歷史意義，但不支援任何加分或 Gate 關閉。

## 證據分類

- `SUFFICIENT`：現有 evidence 已足以支持該主張。
- `LOCAL`：可在本機、CI 或 disposable DB 取得。
- `DECISION`：需產品／風險 owner 決定。
- `EXTERNAL_SANDBOX`：需官方非正式環境，例如 PayUni sandbox。
- `MANUAL`：需人工檢查、簽核或演練。
- `PRODUCTION`：只能在正式環境觀察取得；WP-85 不得執行。

`RUNTIME_ONLY`、`OPEN_LOCAL` 與 `INSUFFICIENT_EVIDENCE` 都不是 `SUFFICIENT`。

## 十分類 7.5 證據矩陣

| ID | 類別 | 現行 | 已有可支持 evidence | 最小 7.5 驗收證據／完成定義 | Primary／Secondary class | Gate | 禁止誤稱 |
|---|---|---:|---|---|---|---|---|
| CAT-01 | 產品核心功能 | 7.0 | snapshot lint、typecheck、build、923 tests；WP-08 回歸 | 分批可安全歸屬的核心 product change manifest；每批相稱 unit/integration/browser、lint、typecheck、build；live/form/catalog/checkout 成功與錯誤 journey receipt | `LOCAL`／`NONE` | `UNMAPPED` | 不得用單一 route test 外推全產品。 |
| CAT-02 | 註冊、登入與主要使用流程 | 8.0 | WP-08：39 Browser、119 files／939 tests、Prisma、lint、typecheck、cleanup | 保持上述同次 closure，新增變更不得破壞 login/reset/MFA/authenticated commerce journey | `SUFFICIENT`／`PRODUCTION` | `UNMAPPED` | 不得宣稱已驗證外部 Email 或正式 session。 |
| CAT-03 | 認證、權限與安全 | 6.0 | M2 inventory、targeted fixes；G1 仍 blocked | explicit `ACCEPT` 的 own-resource allow／another-owner deny／unauthenticated deny／role mismatch deny E2E，加上高風險 direct-URL matrix；D-001～D-004 與 Supabase ACL receipt 另依其邊界完成 | `LOCAL`／`DECISION` | G1 | 不得把 WP-25 conflict 或 WP-53～57 runtime artifacts 升格。 |
| CAT-04 | 金流、訂閱、退款與帳務 | 4.0 | checkout/webhook/refund/payout code 與 local tests | PayUni official sandbox allowlist、synthetic initiation／success／failure-cancel、valid-invalid signature、duplicate/out-of-order callback、DB invariant、full/partial refund、duplicate/over-refund rejection、reconciliation idempotency，及相關 deterministic receipts | `EXTERNAL_SANDBOX`／`DECISION` | `UNMAPPED` | 不得使用 production merchant、資料或把 mock 當 sandbox receipt。 |
| CAT-05 | 資料完整性、Migration、備份與恢復 | 5.0 | disposable migration deploy/status、WP-12/13/14 receipts | synthetic disposable backup manifest/checksum、isolated restore、schema/version verification、forward recovery、domain invariant、marker cleanup與可重跑 receipt | `LOCAL`／`PRODUCTION` | G2 | 不得稱 production backup/restore 已演練。 |
| CAT-06 | UX、RWD、無障礙與錯誤狀態 | 7.0 | axe、keyboard/focus、skip link、reduced motion、mobile overflow/touch target | public/authenticated/billing journey 的 axe、keyboard/focus、mobile viewport、loading/empty/error browser matrix；真人 NVDA/VoiceOver 結果另列 | `LOCAL`／`MANUAL` | `UNMAPPED` | 不得用 axe 取代 screen-reader 簽核。 |
| CAT-07 | Unit、Integration、E2E 與回歸 | 9.0 | WP-08 119 files／939 tests、39 Browser、0 failed/0 skipped、quality gates | 維持基線；新增變更有相稱 deterministic coverage，沒有新增 skip/retry 或降低 assertion | `SUFFICIENT`／`NONE` | `UNMAPPED` | 不得把測試數量外推為商業或 production readiness。 |
| CAT-08 | 效能、可靠性、Log、監控與追蹤 | 5.0 | 三個 local performance budgets、rate-limit、CSP、cleanup/integrity | public/authenticated/billing budgets；timeout/retry/duplicate/late-event fail-closed matrix；sanitized structured-log assertions；receiver delivery receipt 另列 | `LOCAL`／`EXTERNAL_SANDBOX` | `UNMAPPED` | 不得把程式 wiring 當 telemetry delivery。 |
| CAT-09 | 部署、環境、Release 與回滾 | 5.0 | isolated production build、synthetic env、cleanup | no-dotenv package manifest、synthetic configuration validation、artifact rollback dry-run、DB forward-only/restore boundary及 cleanup receipt | `LOCAL`／`PRODUCTION` | `UNMAPPED` | 不得把 dry-run 說成已部署或 production rollback。 |
| CAT-10 | 可販售文件、客服、法務與營運 | 2.0 | runbook、manual actions、QA docs | versioned onboarding、support escalation/refund SOP、terms/privacy/refund policy、incident runbook與 owner acceptance；法務/客服/商家演練需人類 receipt | `LOCAL`／`MANUAL` | `UNMAPPED` | 不得把文件存在當成法務、客服或商業上線簽核。 |

WP-08 是 no-dotenv canonical run：Browser 39、119 files／939 tests，且 Prisma、lint、typecheck、strict-index、cleanup 均通過；它只支持實際涵蓋的 local regression evidence。

## Gate 與既有 acceptance 狀態

| Gate | 可驗證狀態 | 缺口 |
|---|---|---|
| G1 | `BLOCKED` | WP-25=`CONFLICT/UNPROVEN`；WP-53～57=`RUNTIME_ONLY`；M2-A01 owner-boundary E2E=`OPEN_LOCAL`；broad route×role direct URL matrix=`INSUFFICIENT_EVIDENCE`。 |
| G2 | `NO_VERIFIED_ITEM` | backup → restore → forward-recovery 尚無本輪 canonical rehearsal。 |
| G3 | `NO_VERIFIED_ITEM` | 本輪來源未提供可驗證 gate item。 |
| G4 | `NO_VERIFIED_ITEM` | 本輪來源未提供可驗證 gate item。 |
| G5 | `NO_VERIFIED_ITEM` | 本輪來源未提供可驗證 gate item。 |
| G6 | `NO_VERIFIED_ITEM` | 本輪來源未提供可驗證 gate item。 |

外部／人工缺口：Supabase ACL、PayUni、deployment/data、observability、accessibility/legal/ops；產品決策：D-001～D-004。它們不因 local evidence 而被消除。

## Value-ranked backlog

排序規則：先處理已證實 Gate；同 Gate 先比較風險降低再比使用者／上線價值；再選 `LOCAL` 且可產生 deterministic evidence；最後比較維護性與成本。分數 1–5，成本越高代表越難；可立即取得性 0–2。

| Rank | Backlog | Gate | Evidence class | Value | Risk ↓ | Cost | Maintain | Ready | 依賴／排序理由 |
|---:|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | **WP-86 Candidate — M2-A01 owner-boundary E2E 與最高風險 direct-URL access boundary closure** | G1 | `LOCAL` | 5 | 5 | 3 | 4 | 2 | 直接解除已證實的 G1；owner/cross-user 資源邊界是高影響風險，且可產生 canonical deterministic evidence。 |
| 2 | G1 broad route×role×direct-URL matrix consolidation | G1 | `LOCAL` | 5 | 5 | 4 | 5 | 1 | 依賴 WP-86 的 ownership/fixture pattern；以整合 matrix 取代碎片 route runner。 |
| 3 | Disposable DB backup → restore → forward recovery rehearsal | G2 | `LOCAL` | 5 | 5 | 3 | 4 | 2 | 對資料損失與 release recovery 高價值；使用者已授權 disposable DB。 |
| 4 | PayUni official sandbox payment/refund/reconciliation matrix | `UNMAPPED` | `EXTERNAL_SANDBOX` | 5 | 5 | 5 | 3 | 0 | 需 official sandbox allowlist、credential、callback host；不得 fallback production。 |
| 5 | Local release packaging and rollback dry-run | `UNMAPPED` | `LOCAL` | 4 | 4 | 3 | 4 | 2 | 可重用 manifest；實際 deploy/rollback 仍為 production。 |
| 6 | Cross-journey UX/a11y automation | `UNMAPPED` | `LOCAL` | 4 | 3 | 3 | 4 | 2 | 補 CAT-06 到 7.5，不能取代 screen-reader。 |
| 7 | Reliability/performance local evidence | `UNMAPPED` | `LOCAL` | 4 | 4 | 4 | 4 | 2 | 補 CAT-08 真實失敗模式；delivery 仍需要 receiver receipt。 |
| 8 | Core product dirty-batch verification | `UNMAPPED` | `LOCAL` | 5 | 4 | 5 | 3 | 1 | 僅於 hunks ownership 可拆時進行。 |
| 9 | Sales/support/operations documentation packet | `UNMAPPED` | `LOCAL` | 3 | 3 | 2 | 4 | 2 | 可推進 CAT-10，但人工 acceptance 保留。 |
| 10 | D-001～D-004 product decisions | `UNMAPPED` | `DECISION` | 4 | 4 | 2 | 5 | 0 | owner 決定後才可實作。 |
| 11 | Supabase ACL／RLS evidence | `UNMAPPED` | `PRODUCTION` | 5 | 5 | 4 | 3 | 0 | platform owner only。 |
| 12 | Observability delivery | `UNMAPPED` | `PRODUCTION` | 4 | 4 | 3 | 3 | 0 | external receiver evidence required。 |
| 13 | Accessibility, legal, support, onboarding signoff | `UNMAPPED` | `MANUAL` | 5 | 4 | 4 | 3 | 0 | 必須以人類旅程／簽核取得。 |

## Next implementation WP selection

選定、但在本 WP **沒有執行**：

`WP-86 Candidate — M2-A01 Owner-boundary E2E 與最高風險 direct-URL access boundary closure`

它優先於其他自動工作，因為直接對應 `G1=BLOCKED`、是 `OPEN_LOCAL`、可證明 owner／跨使用者資源邊界，並能以單一 canonical matrix 漸進取代重複的 route-specific runner。其後才做 broad matrix 與 G2 backup recovery。

未來 WP-86 的驗收需涵蓋：own-resource allowed、another-owner resource denied、unauthenticated denied/redirected、role mismatch denied、最高風險 protected route direct URL 最小矩陣、fixture 隔離、disposable restore與 forward-recovery evidence。它必須先取得新的 Sol plan，並確認所有既有 dirty specs/scripts 的 hunks 可安全分離。

歷史候選 `WP-85_ISOLATED_WP25_REVERIFICATION`：**`SUPERSEDED_NOT_EXECUTED`**。沒有 receipt、沒有 acceptance，也沒有完成宣稱。

## Sources、ownership 與 validation

- `docs/launch/production-readiness-baseline.md`（2026-07-29 baseline）
- `docs/launch/wp08-product-browser-qa-20260728.md`（WP-08 canonical receipt 摘要）
- `docs/launch/m2-g1-acceptance-ledger-20260730.md`（G1/WP-25/WP-53～57 authority）
- `docs/launch/m2-security-authorization-inventory-20260729.md`（M2-A01、matrix、decisions/external register）
- `docs/launch/manual-blockers.md`、`docs/launch/evidence-index.md`

本文件是 WP-85 唯一 owned path。既有 tracked/untracked changes 全部保留，staged index 必須維持空；不修改 baseline、ledger、inventory、Goal state 或 progress log。

本包 deterministic validation：十類分數為 58；存在 `CAT-01` 到 `CAT-10`、六種 evidence class、`UNPROVEN_LEGACY_DERIVATION`、`SUPERSEDED_NOT_EXECUTED`、G1～G6 coverage 以及 WP-86 Candidate。產品 tests／sandbox／production 皆為 `NOT_RUN_BY_DESIGN`。
