# CelebrateDeal Canonical Quality Scorecard

最後更新：2026-07-25 22:21（Asia/Taipei）

> 分數由 `CELEBRATEDEAL_PLAN.md` 匯入。未取得本輪新證據前不調高。每次變更分數必須在 Score History 記錄。

| ID | 類型 | 項目 | 範圍 | 基準分數 | 目前分數 | 目標 | 信心 | 證據 | 扣分原因 | 未完成檢查 | 下一步 | 驗證方式 | Skill/工具 | 手動依賴 | 可自動化分數 | 人工後預期 | 狀態 | 最後驗證 |
|---|---|---|---|---:|---:|---:|---|---|---|---|---|---|---|---|---:|---:|---|---|
| Q01 | 品質 | 需求符合度與功能正確性 | 全專案 | 58 | 88 | 100 | High | 27 項需求到實作、unit/DB/E2E、manual/decision 的追溯矩陣 | onboarding/live product acceptance 與外部 Gate 尚未封閉 | R-026/R-027 | 收斂產品決策與外部證據 | 文件＋測試對照 | rg／QA | 是：產品/外部 | 95 | 100 | 進行中 | 2026-07-25 |
| Q02 | 品質 | 架構與模組邊界 | Next/Prisma | 78 | 92 | 100 | High | 187-file import graph；domain→UI=0、API→component=0、runtime cycle=0；可執行 Gate | 2,272-line root actions 尚待漸進拆分 | domain extraction | 依風險逐批拆 actions | AST boundary test＋review | architecture | 否 | 100 | 100 | 進行中 | 2026-07-25 |
| Q03 | 品質 | 程式碼品質與可維護性 | Server Actions/lib | 70 | 86 | 100 | High | lint/typecheck；architecture debt ledger、root action ceiling、production complexity/function-size ratchets | 8 個既有 complexity/size 熱點與 root actions 42 exports | hotspot extraction/duplication | 小批拆分＋clone scan | lint＋review | review | 否 | 100 | 100 | 進行中 | 2026-07-25 |
| Q04 | 品質 | 型別安全與靜態檢查 | TypeScript | 88 | 100 | 100 | High | strict/noEmit/isolatedModules；Production noUncheckedIndexedAccess；suppression=0、explicit any=0；27/27 route registry；雙 typecheck＋241 regression | 無 | 持續防回歸 | CI 保持雙 typecheck | typecheck＋AST policy | TS | 否 | 100 | 100 | 通過 | 2026-07-25 |
| Q05 | 品質 | 安全性與隱私 | 全系統 | 78 | 89 | 100 | High | CSP/CSRF/RLS、security validation batches、public lifecycle、provider trust、isolated DB regression、safe monitoring payload | residual ACL、Codex Security candidate validation 未完 | threat model/scan | 深度安全複審 | security suite | Codex Security | 是 | 95 | 100 | 待驗證 | 2026-07-25 |
| Q06 | 品質 | 認證與授權 | auth/MFA/tenant | 82 | 89 | 100 | High | MFA、tenant matrix、edit ownership、visitor scoping | browser role matrix 與 MFA decision | BOLA/IDOR browser matrix | 負向 E2E | security tests | Security | 否 | 100 | 100 | 待驗證 | 2026-07-25 |
| Q07 | 品質 | 資料完整性與資料庫品質 | Prisma/PostgreSQL | 87 | 94 | 100 | High | 51-model/9-migration inventory、tenant-ledger composite FK negative regression、payment/form concurrency | DB-I01/02/06-10 與外部 aggregate 尚未完成 | drift/orphans | invariant queries | local/staging checks | Prisma/Supabase | 是 | 97 | 100 | 待驗證 | 2026-07-25 |
| Q08 | 品質 | API 契約與外部整合 | APIs/providers | 70 | 80 | 100 | High | 27/27 executable route registry、Zod/route tests、provider-owned boundary、Cloudflare state machine | idempotency/error manifest 與外部 provider evidence 未完整 | error/replay matrix | provider fixtures | contract suite | API review | 是 | 92 | 100 | 待驗證 | 2026-07-25 |
| Q09 | 品質 | 前端 UI 與 UX | 後台/公開頁 | 40 | 82 | 100 | High | actionable onboarding、8-step guarded flow、truthful live status、CTA error、empty/loading feedback、39/39 release browser | template、persistent preview、full-route visual 與真人 task study 尚缺 | task success/mobile | 收斂產品決策並補真人驗收 | browser QA | UX tools | 是：產品/人工 | 100 | 100 | 進行中 | 2026-07-25 |
| Q10 | 品質 | Accessibility | Web UI | 58 | 93 | 100 | Low | release-mode axe 8/8、31 static owner＋14 dynamic commerce＋platform-admin routes、keyboard/focus、skip link、reduced-motion、touch target | 尚缺複雜 error/loading/provider states 與人工 screen-reader | WCAG AA | 擴 state＋manual SR | Playwright | a11y | 是：SR | 95 | 100 | 進行中 | 2026-07-25 |
| Q11 | 品質 | 效能與資源使用 | Public/live | 70 | 90 | 100 | High | account/dashboard/public-live fixed release budgets 3/3；公開 live fixture 含啟用商品 | 尚缺 field CWV 與長期趨勢資料 | field CWV | 上線後收集真實使用者指標 | Playwright/field telemetry | perf | 是：實際流量 | 100 | 100 | 進行中 | 2026-07-25 |
| Q12 | 品質 | 穩定性/錯誤/並行 | Payment/webhook/actions | 75 | 95 | 100 | High | 三輪 lifecycle、atomic retry claim、payment/refund/form concurrency、Cloudflare monotonic DB regression | 全專案 fault-injection 尚未完成 | retry/deadlock | broader failure matrix | Vitest/Playwright | QA | 否 | 100 | 100 | 待改善 | 2026-07-25 |
| Q13 | 品質 | 日誌/監控/可觀測性 | Sentry/PostHog/health | 65 | 80 | 100 | High | safe health wiring；operational errors 只輸出 category、allowlisted code/context；message/meta/URL/password exclusion tests | Sentry／PostHog Production delivery 證據缺 | alert evidence | 外部簽核 | unit＋Dashboard | Chrome/Vercel | 是 | 88 | 100 | 待人工 | 2026-07-25 |
| Q14 | 品質 | 單元測試品質 | src tests | 83 | 95 | 100 | High | 112 files／880 tests；完整來源 V8 coverage 與 global／`src/lib` thresholds 通過；monitoring/public-lifecycle regression | UI/page 主要由 E2E 覆蓋，仍有 0%-unit files | critical untested branches | 補高風險 unit branches | Vitest coverage | QA | 否 | 100 | 100 | 進行中 | 2026-07-25 |
| Q15 | 品質 | 整合測試品質 | Prisma/API | 75 | 87 | 100 | High | isolated DB 原 3 files／45 tests＋form concurrency＋tenant FK negative suites | funnel／remaining provider matrix | funnel matrix | 擴 fixtures | Vitest/Prisma | QA | 否 | 100 | 100 | 待驗證 | 2026-07-25 |
| Q16 | 品質 | E2E 與瀏覽器 QA | Playwright | 55 | 97 | 100 | High | complete release suite 39/39、clean teardown、axe 8/8、performance 3/3、draft-live negative、onboarding/stepper states | 缺 visual regression 與真人 screen-reader journey | visual/manual coverage | 補視覺與人工驗收 | Playwright/Chrome | QA | 是：人工 | 100 | 100 | 進行中 | 2026-07-25 |
| Q17 | 品質 | Build/CI/CD/發布 | GitHub/Vercel | 68 | 90 | 100 | High | deterministic local build；workflow 已加入 audit/secret/full-browser gates | dirty revision 尚未 push，無 GitHub runner evidence | CI policy | 授權後跑 mandatory gates | CI | GitHub | 是 | 95 | 100 | 進行中 | 2026-07-25 |
| Q18 | 品質 | 依賴與供應鏈安全 | npm | 85 | 95 | 100 | High | production audit=0；production brace-expansion fixed；safe scan gate | dev-only ESLint/minimatch upstream chain、SBOM/history scan | audit policy | upstream upgrade＋SBOM | npm/Codex Security | Security | 否 | 100 | 100 | 進行中 | 2026-07-25 |
| Q19 | 品質 | 設定/env/secrets | env/Vercel/CredMan | 80 | 80 | 100 | Medium | schema/preflight | binding/rotation 證據缺 | secret inventory | read-only audit | metadata | Vercel/Supabase | 是 | 90 | 100 | 待驗證 | 2026-07-25 |
| Q20 | 品質 | 文件與實作一致性 | docs/runbooks | 50 | 88 | 100 | High | README release commands 已校正；文件權威/時效地圖；canonical Goal docs | 部分 7/9 planning docs 仍含當時狀態，已明確降級為歷史/參考 | individual runbook procedure audit | 逐份校正真正程序差異 | docs review | rg | 否 | 100 | 100 | 進行中 | 2026-07-25 |
| Q21 | 品質 | Repo hygiene/dead code/債 | repo | 65 | 88 | 100 | High | artifact ownership policy；executable tracked-runtime/debt-marker/focused-test/ignore gates | dirty Goal patches 尚未依授權分 commit；完整 dead-export analysis 尚缺 | dead exports/retention | authorized commit plan＋dead export scan | git/AST | review | 是：commit scope | 97 | 100 | 進行中 | 2026-07-25 |
| Q22 | 品質 | 直播導購商業化 | live commerce | 55 | 78 | 100 | High | public lifecycle fail-closed、truthful status、active products/forms、CTA feedback、mobile commerce E2E/performance | template、常駐 preview、商家停權模型與 conversion 真人驗收尚缺 | workflow acceptance | 完成產品決策與真人驗收 | E2E/UX | Product | 是：產品/人工 | 92 | 100 | 進行中 | 2026-07-25 |
| M01 | 模組 | 認證/MFA/password reset | auth/mfa | 82 | 88 | 100 | High | MFA tests/SOP、password reset concurrent DB regression | Production recovery／browser role 證據 | role/session matrix | browser risk flows | security review | Security | 是 | 95 | 100 | 待驗證 | 2026-07-25 |
| M02 | 模組 | 金流/退款/webhook | PayUni | 85 | 94 | 100 | High | Staging artifact、refund/status invariants、atomic retry、DB concurrency 45-test batch | Production merchant gate 缺 | config signoff | external evidence | PayUni/Supabase | QA | 是 | 96 | 100 | 待驗證 | 2026-07-25 |
| M03 | 模組 | Team Funnel/attribution | funnel | 75 | 86 | 100 | High | attribution/public-page/route negative tests、ownership matrix | Email/analytics/referral decisions、E2E | browser ownership matrix | tenant E2E | Playwright/Security | QA | 否 | 100 | 100 | 待驗證 | 2026-07-25 |
| M04 | 模組 | Cloudflare Stream | upload/webhook/live | 75 | 87 | 100 | High | upload/signature 歷史、monotonic callback DB regression、provider-owned form boundary | exact token/account binding 缺 | owner binding | least privilege | Dashboard/Vitest | Cloudflare | 是 | 92 | 100 | 待驗證 | 2026-07-25 |
| M05 | 模組 | Email/Sentry/PostHog | integrations | 60 | 70 | 100 | Medium | wiring/ops routes；Sentry capture payload 已去除原始 error/context 並有 exclusion tests | Production delivery/event 缺 | external evidence | 簽核摘要 | unit＋Dashboard | 外部平台 | 是 | 82 | 100 | 待人工 | 2026-07-25 |
| M06 | 模組 | Backup/restore | ops/backup | 90 | 90 | 100 | High | drill evidence | schedule/retention/alert | scheduled drill | 受控驗收 | PowerShell/rclone | Ops | 是 | 90 | 100 | 待人工 | 2026-07-25 |
| F01 | 流程 | 商家 onboarding | login→first live | 55 | 75 | 100 | High | dashboard checklist 五項皆可直接進入任務；空狀態與 browser acceptance 通過 | 缺 template/import 與 TTF benchmark | TTF live | 定義並驗證 template flow | Playwright | Product | 是：產品 | 100 | 100 | 進行中 | 2026-07-25 |
| F02 | 流程 | 建立與發布直播 | live stepper | 45 | 78 | 100 | High | 8-step copy/semantics、必填 guard、first-invalid focus、empty/review/pending feedback 與 browser acceptance | 無跨步常駐 preview、業務版型與真人 mobile publish study | mobile publish | 產品決策＋真人驗收 | browser QA | Product | 是：產品/人工 | 100 | 100 | 進行中 | 2026-07-25 |
| F03 | 流程 | 公開頁/報名/affiliate | /p/* | 75 | 93 | 100 | High | public form/live/team-funnel E2E；draft/replay lifecycle；active product/form；axe/mobile/performance；attribution abuse tests | 公開 Email／analytics trust 仍待產品決策；field CWV 尚無流量 | product/privacy/field CWV | 完成 D-001～D-003 與上線後 field evidence | E2E/axe/perf/unit | QA/Product | 是：產品/流量 | 97 | 100 | 進行中 | 2026-07-25 |
| F04 | 流程 | Checkout→paid→refund | PayUni | 85 | 88 | 100 | Medium | Staging artifact；checkout server-side vendor scope 與 active-product assertion；public inactive product exclusion | Production 不可自動實付 | merchant signoff | sandbox regression | PayUni QA | Ops | 是 | 92 | 100 | 待人工 | 2026-07-25 |
| F05 | 流程 | Platform billing/admin | admin | 80 | 88 | 100 | Medium | MFA/finance checks、共用 submit/danger pending feedback、完整 browser/axe regression | 外部 provider 真實錯誤與人工營運 journey 尚缺 | admin matrix | 人工外部營運驗收 | E2E+a11y | Playwright | 是：人工/外部 | 95 | 100 | 進行中 | 2026-07-25 |
| G01 | Gate | 靜態品質 | lint/type/unit/audit | 88 | 99 | 100 | High | lint/雙 typecheck/880 tests/coverage thresholds/72-route build/39 E2E/production audit=0/repository secret scan=0 | workflow candidate 尚無 external runner evidence | external CI run | 授權 push 後跑 mandatory gates | CI/Security | QA | 是：push/CI | 100 | 100 | 進行中 | 2026-07-25 |
| G02 | Gate | Release E2E/build | E2E/build | 55 | 100 | 100 | High | 三輪 25/25→0/0/false→build | 無 | 定期重跑 | 保持 deterministic | Playwright/Next | QA | 否 | 100 | 100 | 通過 | 2026-07-25 |
| G03 | Gate | Supabase Data API | RLS/ACL | 78 | 78 | 100 | High | 52/52、grants=0 | residual ACL=36 | owner remediation | catalog proof | Supabase | Owner | 是 | 90 | 100 | 待人工 | 2026-07-25 |
| G04 | Gate | Production readiness | health/rollback/backup | 82 | 82 | 100 | Medium | 歷史 evidence | freshness/external gaps | canonical evidence | read-only revalidate | Vercel/Supabase | Ops | 是 | 90 | 100 | 待人工 | 2026-07-25 |
| G05 | Gate | 外部服務 | PayUni/Sentry/WAF/CF/PostHog | 50 | 50 | 100 | Medium | 部分歷史 smoke | 多項簽核缺 | evidence pack | non-sensitive signoff | Dashboard | Owners | 是 | 75 | 100 | 待人工 | 2026-07-25 |
| G06 | Gate | 文件與證據可追溯性 | docs/reports | 55 | 90 | 100 | High | canonical index、27-requirement trace、API/Prisma inventories、dated reports、document authority map | external evidence 與個別 runbook procedure audit 未完全收斂 | evidence freshness | dated attestations＋runbook audit | docs review | QA | 否 | 100 | 100 | 進行中 | 2026-07-25 |

## Score History

| 時間 | ID | 原分數 | 新分數 | 原因 | 證據 |
|---|---|---:|---:|---|---|
| 2026-07-25 01:18 | ALL | — | 基準匯入 | 從 Goal plan 建立 canonical scorecard，未調高任何分數 | `CELEBRATEDEAL_PLAN.md` |
| 2026-07-25 01:37 | Q12 | 75 | 82 | E2E lifecycle 已證明 deterministic；故障注入仍未完整 | Phase 1 evidence |
| 2026-07-25 01:37 | Q16 | 55 | 75 | 四次 25/25 release E2E 與 clean teardown | Phase 1 evidence |
| 2026-07-25 01:37 | Q17 | 68 | 80 | clean build 可重現；CI gates 仍待補 | Phase 1 evidence |
| 2026-07-25 01:37 | Q18 | 85 | 92 | PostCSS 修補，production audit=0 | package lock＋audit |
| 2026-07-25 01:37 | Q20 | 50 | 62 | Windows/WSL README 校正＋canonical evidence | README／codex-goal |
| 2026-07-25 01:37 | G01 | 88 | 96 | lint/type/784 tests/audit/secret scan 全綠 | Phase 1 regression |
| 2026-07-25 01:37 | G02 | 55 | 100 | 三次 E2E→cleanup→build 全綠 | lifecycle matrix |
| 2026-07-25 17:46 | Q05 | 78 | 78 | Codex Security standard scan 產生 52 個候選 finding；尚未 validation，不調分 | `reports/quality/20260725T094618Z-continuation-baseline.md` |
| 2026-07-25 17:46 | G06 | 55 | 55 | 續跑基準與 scan 摘要已索引；整體 evidence traceability 仍未完成 | `ARTIFACT_INDEX.md` |
| 2026-07-25 18:24 | Q12 | 82 | 86 | Payment status/refund invariants 與 webhook retry atomic claim 已 targeted regression；DB concurrency 尚待 isolated DB | `reports/quality/20260725T102120Z-payment-webhook-security-validation.md` |
| 2026-07-25 18:24 | M02 | 85 | 88 | 5 個 payment/refund/webhook high candidates 已驗證並本機修正；Production gate 與 DB integration 未完成 | `reports/quality/20260725T102120Z-payment-webhook-security-validation.md` |
| 2026-07-25 18:35 | Q05 | 78 | 82 | 7 個 authorization/privacy candidates 已驗證並本機修正；全候選驗證與 residual ACL 未完成 | `reports/quality/20260725T103250Z-authorization-tenant-validation.md` |
| 2026-07-25 18:35 | Q06 | 82 | 86 | inactive-member、duplicate attribution、page lifecycle 與 visitor tenant scoping 已補 | `reports/quality/20260725T103250Z-authorization-tenant-validation.md` |
| 2026-07-25 18:35 | M03 | 75 | 82 | Team Funnel attribution 與公開頁 ownership/lifecycle negative cases 已補；read IDOR 尚待 | `reports/quality/20260725T103250Z-authorization-tenant-validation.md` |
| 2026-07-25 18:48 | Q05 | 82 | 84 | 三個 public write routes 補齊 live lifecycle 與 analytics product binding | `reports/quality/20260725T103250Z-authorization-tenant-validation.md` |
| 2026-07-25 18:48 | Q06 | 86 | 89 | 27-route／47-action matrix 完成，template edit read IDOR 已修正 | `AUTHORIZATION_MATRIX.md` |
| 2026-07-25 18:48 | M03 | 82 | 86 | Team Funnel edit ownership、public lifecycle 與 product-click relation 已補 | `reports/quality/20260725T103250Z-authorization-tenant-validation.md` |
| 2026-07-25 18:56 | Q05 | 84 | 86 | Cloudflare provider-owned UID/state 不再由 vendor 表單控制，stale callback fail closed | `reports/quality/20260725T105644Z-cloudflare-provider-trust-validation.md` |
| 2026-07-25 18:56 | Q08 | 70 | 74 | Provider form boundary 與 callback state contract 補齊；DB route regression 仍待 | `reports/quality/20260725T105644Z-cloudflare-provider-trust-validation.md` |
| 2026-07-25 18:56 | Q12 | 86 | 88 | Cloudflare callback 採單調狀態與 conditional claim；DB concurrency 尚待 | `reports/quality/20260725T105644Z-cloudflare-provider-trust-validation.md` |
| 2026-07-25 18:56 | M04 | 75 | 83 | provider-owned mapping 邊界與 stale callback 已 targeted regression；exact binding 仍為人工 gate | `reports/quality/20260725T105644Z-cloudflare-provider-trust-validation.md` |
| 2026-07-25 19:04 | Q05 | 86 | 87 | security fixes 於 loopback-only PostgreSQL 取得 DB-backed regression | `reports/quality/20260725T110437Z-isolated-db-security-regression.md` |
| 2026-07-25 19:04 | Q07 | 87 | 90 | 8 migrations 與 payment ledger invariants 於 isolated PostgreSQL 通過 | `reports/quality/20260725T110437Z-isolated-db-security-regression.md` |
| 2026-07-25 19:04 | Q12 | 88 | 94 | password/payment/Cloudflare concurrency 與 stale-state DB regression 45/45 | `reports/quality/20260725T110437Z-isolated-db-security-regression.md` |
| 2026-07-25 19:04 | Q15 | 75 | 84 | 三個 DB-backed integration suites、45 tests 通過 | `reports/quality/20260725T110437Z-isolated-db-security-regression.md` |
| 2026-07-25 19:04 | M01 | 82 | 88 | password reset concurrent consumer atomic claim DB regression 通過 | `reports/quality/20260725T110437Z-isolated-db-security-regression.md` |
| 2026-07-25 19:04 | M02 | 88 | 94 | logical-order／commission concurrency、refund invariants DB regression 通過 | `reports/quality/20260725T110437Z-isolated-db-security-regression.md` |
| 2026-07-25 19:04 | M04 | 83 | 87 | Cloudflare stale processing/error route regression 於 isolated DB 通過 | `reports/quality/20260725T110437Z-isolated-db-security-regression.md` |
| 2026-07-25 19:25 | Q07 | 90 | 94 | 51 models／9 migrations inventory、tenant-ledger composite FK 與跨 tenant negative regression 通過 | `reports/quality/20260725T112500Z-api-prisma-contract-evidence.md` |
| 2026-07-25 19:25 | Q08 | 74 | 80 | 27/27 route contracts 具 executable coverage，form/Cloudflare contract 有 DB-backed evidence | `reports/quality/20260725T112500Z-api-prisma-contract-evidence.md` |
| 2026-07-25 19:25 | Q12 | 94 | 95 | form deterministic-ID concurrent requests 已在 isolated DB 收斂為單一 row | `reports/quality/20260725T112500Z-api-prisma-contract-evidence.md` |
| 2026-07-25 19:25 | Q15 | 84 | 87 | 新增 form concurrency 與 tenant-ledger FK 兩個 isolated DB suites | `reports/quality/20260725T112500Z-api-prisma-contract-evidence.md` |
| 2026-07-25 19:25 | G06 | 55 | 65 | API／Prisma canonical inventories 以可執行測試防止覆蓋漂移 | `reports/quality/20260725T112500Z-api-prisma-contract-evidence.md` |
| 2026-07-25 19:52 | Q09 | 40 | 48 | 修正 app-shell 導覽遮擋、mobile target 與 account/dashboard 對比；完整 UX workflow 尚待 | `reports/quality/20260725T115122Z-windows-browser-a11y-performance.md` |
| 2026-07-25 19:52 | Q10 | 58 | 82 | release-mode axe、keyboard/focus、skip link、reduced-motion、mobile target 5/5；manual SR 尚待 | `reports/quality/20260725T115122Z-windows-browser-a11y-performance.md` |
| 2026-07-25 19:52 | Q11 | 70 | 82 | account routes 與 authenticated dashboard 固定 performance budgets 2/2 | `reports/quality/20260725T115122Z-windows-browser-a11y-performance.md` |
| 2026-07-25 19:52 | Q16 | 75 | 84 | browser QA 新增可重現 axe 5/5 與 performance 2/2 | `reports/quality/20260725T115122Z-windows-browser-a11y-performance.md` |
| 2026-07-25 19:52 | G06 | 65 | 70 | 新增 dated browser/a11y/performance raw evidence 並索引 | `reports/quality/20260725T115122Z-windows-browser-a11y-performance.md` |
| 2026-07-25 20:01 | Q10 | 82 | 88 | axe 擴張至 31 個 static authenticated owner routes，修正 missing label 與 residual contrast | `reports/quality/20260725T115122Z-windows-browser-a11y-performance.md` |
| 2026-07-25 20:01 | Q16 | 84 | 87 | 全後台主要靜態 owner routes 已納入 release browser Gate | `reports/quality/20260725T115122Z-windows-browser-a11y-performance.md` |
| 2026-07-25 20:12 | Q10 | 88 | 93 | axe 再擴至 14 個 dynamic commerce routes 與 platform-admin MFA/operations；完整 suite 8/8 | `reports/quality/20260725T115122Z-windows-browser-a11y-performance.md` |
| 2026-07-25 20:12 | Q16 | 87 | 91 | dynamic owner/public commerce 與 platform-admin browser fixtures 納入 release Gate | `reports/quality/20260725T115122Z-windows-browser-a11y-performance.md` |
| 2026-07-25 20:39 | Q16 | 91 | 94 | smoke＋a11y＋performance 合併 release browser suite 35/35，lifecycle cleanup 全綠 | `reports/quality/20260725T123900Z-release-regression-ci-hardening.md` |
| 2026-07-25 20:39 | Q17 | 80 | 90 | workflow candidate 補 production audit、safe secret scan 與完整 browser gates；runner 尚待 | `reports/quality/20260725T123900Z-release-regression-ci-hardening.md` |
| 2026-07-25 20:39 | Q18 | 92 | 95 | production dependency audit 0；production dependency 修補；dev upstream exception 明列 | `reports/quality/20260725T123900Z-release-regression-ci-hardening.md` |
| 2026-07-25 20:39 | G01 | 96 | 98 | lint/type/106 files/844 tests、production audit 0、repository secret scan 0 | `reports/quality/20260725T123900Z-release-regression-ci-hardening.md` |
| 2026-07-25 20:49 | Q14 | 83 | 93 | 完整來源 V8 baseline 與 global／`src/lib` coverage thresholds 進入 CI；106/844 通過 | `reports/quality/20260725T124900Z-coverage-gate.md` |
| 2026-07-25 20:49 | G01 | 98 | 99 | coverage threshold 已可重現通過；只剩未獲授權的 external runner evidence | `reports/quality/20260725T124900Z-coverage-gate.md` |
| 2026-07-25 20:51 | Q01 | 58 | 88 | 27 項核心需求已一對一追溯至實作、unit/DB/E2E 與人工/決策缺口 | `docs/codex-goal/REQUIREMENTS_TRACEABILITY.md` |
| 2026-07-25 20:51 | G06 | 70 | 82 | 新增 canonical requirements traceability；不再讓規格、測試與人工 Gate 分散 | `docs/codex-goal/REQUIREMENTS_TRACEABILITY.md` |
| 2026-07-25 20:54 | Q02 | 78 | 92 | 187-file runtime import graph無 cycle／反向 domain dependency；4 項 executable architecture gates | `reports/quality/20260725T125400Z-architecture-boundaries.md` |
| 2026-07-25 20:54 | Q03 | 70 | 80 | root actions 債務量化並設 2,300-line ratchet；lint/typecheck/boundaries 全綠 | `docs/codex-goal/ARCHITECTURE_BOUNDARIES.md` |
| 2026-07-25 20:55 | Q03 | 80 | 86 | production complexity≤30／function≤300 defaults；8 個既有熱點採目前值防回歸 ceiling；全倉 lint 通過 | `docs/codex-goal/ARCHITECTURE_BOUNDARIES.md` |
| 2026-07-25 20:58 | Q20 | 62 | 88 | README release Gate 與現況一致；current/runbook/historical/research 文件具明確權威與時效規則 | `docs/DOCUMENT_AUTHORITY.md` |
| 2026-07-25 20:58 | G06 | 82 | 90 | dated evidence、requirements trace 與 document supersession chain 已串接 | `docs/DOCUMENT_AUTHORITY.md` |
| 2026-07-25 21:00 | Q21 | 65 | 88 | artifacts ownership 明文化；runtime/secret/archive、debt marker、focused tests、ignore policy 具 executable Gate | `docs/codex-goal/REPOSITORY_HYGIENE.md` |
| 2026-07-25 21:02 | Q04 | 88 | 96 | strict compiler policy、Production diagnostics suppression=0、explicit any=0 與 executable boundary registry | `scripts/type-safety-policy.test.ts` |
| 2026-07-25 21:08 | Q04 | 96 | 100 | Production `noUncheckedIndexedAccess` 0 errors；13-file hardening、241 regression、lint與雙 typecheck 全綠 | `reports/quality/20260725T130800Z-strict-index-type-safety.md` |
| 2026-07-25 21:16 | Q14 | 93 | 94 | strict-index 後 coverage 微幅回歸未降低門檻；109 files／857 tests 與 global／`src/lib` 8 項 thresholds 全綠 | `reports/quality/20260725T131654Z-coverage-threshold-recovery.md` |
| 2026-07-25 21:26 | Q11 | 82 | 90 | 公開直播導購頁納入固定 release 載入／資源預算；performance 3/3 | `reports/quality/20260725T132632Z-public-live-performance.md` |
| 2026-07-25 21:26 | F03 | 75 | 90 | 公開 form/live/team-funnel 已具 E2E、axe/mobile、performance 與 lifecycle/abuse regression | `reports/quality/20260725T132632Z-public-live-performance.md` |
| 2026-07-25 21:49 | Q09 | 48 | 78 | actionable onboarding、8-step validation、空狀態與全域送出回饋；38/38 browser 通過 | `reports/quality/20260725T134921Z-onboarding-live-stepper-ux.md` |
| 2026-07-25 21:49 | Q16 | 94 | 96 | onboarding 與 live stepper 複雜互動狀態納入 release Gate；38/38 與 clean teardown | `reports/quality/20260725T134921Z-onboarding-live-stepper-ux.md` |
| 2026-07-25 21:49 | F01 | 55 | 75 | Dashboard checklist 從靜態狀態改為五個可執行下一步並有 browser acceptance | `reports/quality/20260725T134921Z-onboarding-live-stepper-ux.md` |
| 2026-07-25 21:49 | F02 | 45 | 78 | 8-step copy/semantics、forward guard、invalid focus、review/empty/pending feedback均已驗證 | `reports/quality/20260725T134921Z-onboarding-live-stepper-ux.md` |
| 2026-07-25 21:49 | F05 | 80 | 88 | 全域 Submit/Danger button 具 pending、disabled、status，完整 admin/MFA regression 全綠 | `reports/quality/20260725T134921Z-onboarding-live-stepper-ux.md` |
| 2026-07-25 22:21 | Q05 | 87 | 89 | operational monitoring 不再傳送原始 error/context；公開 draft/replay lifecycle fail closed | `reports/quality/20260725T142132Z-safe-observability-public-live-lifecycle.md` |
| 2026-07-25 22:21 | Q09 | 78 | 82 | 公開直播顯示真實狀態、CTA 失敗回饋與正確 panel semantics；39/39 browser 通過 | `reports/quality/20260725T142132Z-safe-observability-public-live-lifecycle.md` |
| 2026-07-25 22:21 | Q13 | 65 | 80 | monitoring 只保留安全 category、code 與 allowlisted context，敏感 payload exclusion tests 通過 | `reports/quality/20260725T142132Z-safe-observability-public-live-lifecycle.md` |
| 2026-07-25 22:21 | Q14 | 94 | 95 | 112 files／880 tests，monitoring 與 public lifecycle unit regression 納入 coverage Gate | `reports/quality/20260725T142132Z-safe-observability-public-live-lifecycle.md` |
| 2026-07-25 22:21 | Q16 | 96 | 97 | draft-live negative path與 ARIA regression 納入完整 release browser 39/39 | `reports/quality/20260725T142132Z-safe-observability-public-live-lifecycle.md` |
| 2026-07-25 22:21 | Q22 | 55 | 78 | public lifecycle、active catalog、truthful status 與 CTA error 已成為可重現驗收 | `reports/quality/20260725T142132Z-safe-observability-public-live-lifecycle.md` |
| 2026-07-25 22:21 | M05 | 60 | 70 | Sentry wiring 不再接收原始 operational error/context；Production delivery 仍待人工 | `reports/quality/20260725T142132Z-safe-observability-public-live-lifecycle.md` |
| 2026-07-25 22:21 | F03 | 90 | 93 | public live lifecycle、inactive product/form、mobile/axe/performance negative path完成 | `reports/quality/20260725T142132Z-safe-observability-public-live-lifecycle.md` |
| 2026-07-25 22:21 | F04 | 85 | 88 | checkout vendor scope與 active-product lookup 有 regression assertion | `reports/quality/20260725T142132Z-safe-observability-public-live-lifecycle.md` |
