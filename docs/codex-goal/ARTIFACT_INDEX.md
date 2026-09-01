# CelebrateDeal Artifact Index

最後更新：2026-07-25 22:21（Asia/Taipei）

## Canonical artifacts

| Artifact | 狀態 | 用途 |
|---|---|---|
| `docs/codex-goal/PROGRESS.md` | active | 單一進度來源 |
| `docs/codex-goal/QUALITY_SCORECARD.md` | active | Q/M/F/G 分數 |
| `docs/codex-goal/CODE_REVIEW_REPORT.md` | active | 可重現 findings |
| `docs/codex-goal/QA_REPORT.md` | active | 測試與環境證據 |
| `docs/codex-goal/MANUAL_ACTIONS.md` | active | 人工例外 |
| `docs/codex-goal/DECISIONS_NEEDED.md` | active | 真正產品決策 |
| `docs/codex-goal/COMMAND_LOG.md` | active | sanitized command trail |
| `docs/codex-goal/AUTHORIZATION_MATRIX.md` | active | route × role × tenant × MFA inventory |
| `docs/codex-goal/API_CONTRACT_REGISTRY.md` | active | 63 route caller/input/tenant/replay/response contract rows |
| `docs/codex-goal/PRISMA_INVARIANTS.md` | active | 51 model／9 migration invariant inventory |
| `docs/codex-goal/REQUIREMENTS_TRACEABILITY.md` | active | 27 項需求到實作、測試、外部 Gate 與決策的追溯矩陣 |
| `docs/codex-goal/ARCHITECTURE_BOUNDARIES.md` | active | 分層、依賴方向、runtime cycle 與 root actions debt ownership |
| `docs/DOCUMENT_AUTHORITY.md` | active | current/runbook/historical/research 文件權威與 supersession 規則 |
| `docs/codex-goal/REPOSITORY_HYGIENE.md` | active | artifacts ownership、ignore/retention 與 executable hygiene Gate |

## 既有 QA/security artifacts（保護、不覆寫）

| Artifact | Git 狀態 | 摘要 |
|---|---|---|
| `reports/ai-team/qa-payuni-sandbox/20260724T043221482Z.json` | untracked/existing | Staging PayUni 四個 gate evidence |
| `reports/security/data-api-hardening/20260724T085911175Z.json` | untracked/existing | Staging Data API hardening evidence |

## 本輪新增 raw evidence

| Artifact | 摘要 |
|---|---|
| `reports/quality/20260724T171800098Z-preflight.md` | Windows/Git/process/DB-isolation metadata baseline |
| `reports/quality/20260724T173700000Z-phase1-lifecycle.md` | DB fail-closed、三輪 E2E lifecycle、build、audit regression |
| `reports/quality/20260725T094618Z-continuation-baseline.md` | 續跑 Windows/Git/repo/security scan baseline |
| `reports/quality/20260725T095345Z-security-candidate-summary.md` | Codex Security candidate severity/category distribution and validation batches |
| `reports/quality/20260725T102120Z-payment-webhook-security-validation.md` | 5 個 payment/refund/webhook high candidates、修正與 targeted regression 證據 |
| `reports/quality/20260725T103250Z-authorization-tenant-validation.md` | 7 個 authorization/privacy candidates、修正與 targeted regression 證據 |
| `reports/quality/20260725T105644Z-cloudflare-provider-trust-validation.md` | stale callback 狀態機、provider-owned form boundary 與 targeted regression |
| `reports/quality/20260725T110437Z-isolated-db-security-regression.md` | loopback-only PostgreSQL 18、8 migrations、password/payment/Cloudflare 45/45 DB regression |
| `reports/quality/20260725T112500Z-api-prisma-contract-evidence.md` | 27-route contract coverage、51-model/9-migration inventory、form concurrency、tenant-ledger FK negative regression |
| `reports/quality/20260725T115122Z-windows-browser-a11y-performance.md` | Windows release-mode axe、keyboard、focus、reduced-motion、mobile touch target 與固定路徑 performance gates |
| `reports/quality/20260725T123900Z-release-regression-ci-hardening.md` | 完整 release regression、Prisma transaction admission 與 CI hardening evidence |
| `reports/quality/20260725T124900Z-coverage-gate.md` | 完整來源 V8 coverage baseline、global／domain threshold 與 CI 防回歸證據 |
| `reports/quality/20260725T125400Z-architecture-boundaries.md` | 187-file import graph、4 項可執行 boundary/cycle/debt-ceiling Gate |
| `reports/quality/20260725T130800Z-strict-index-type-safety.md` | Production `noUncheckedIndexedAccess` 修正、241-test regression 與 CI Gate |
| `reports/quality/20260725T131654Z-coverage-threshold-recovery.md` | strict-index 後 coverage recovery；109 files／857 tests 與 8 項 threshold 通過 |
| `reports/quality/20260725T132345Z-windows-release-regression.md` | strict-index 後 Windows 35/35 release browser、build、static/security/backup gates 與 clean teardown |
| `reports/quality/20260725T134921Z-onboarding-live-stepper-ux.md` | actionable onboarding、8-step live guard、全域 submit feedback 與 38/38 release browser 驗收 |
| `reports/quality/20260725T132632Z-public-live-performance.md` | account/dashboard/public-live 3/3 固定 performance budget 與邊界 |
| `reports/quality/20260725T142132Z-safe-observability-public-live-lifecycle.md` | safe monitoring payload、public-live lifecycle／catalog hardening、ARIA recovery 與 39/39 release regression |
| `reports/quality/20260725T142900Z-codex-security-completion-status.md` | completed/sealed manifest、final 52 reportable findings 與 dirty-fix 複審邊界 |

## External local-only scan artifacts

| Artifact | 摘要 | Repository 狀態 |
|---|---|---|
| Codex Security scan `a145a0a8-2034-4517-80d5-5ddb344dfdf1` | completed/sealed；52 reportable findings for revision `35d8f59341bcb776e548c69fe874a3f4d1fe2528`；medium confidence；需與 dirty fixes 交叉核對 | Local temp outside repo |

`FINAL_REPORT.md` 只會在 Definition of Done 真正完成時建立。
