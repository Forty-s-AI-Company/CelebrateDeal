# Recovery Evidence Index

## 本次原始快照

- `.ai-team/reports/hybrid-recovery-20260727/initial-git-status.txt`
- `.ai-team/reports/hybrid-recovery-20260727/initial-git-diff-stat.txt`
- `.ai-team/reports/hybrid-recovery-20260727/initial-worktrees.txt`
- `.ai-team/reports/hybrid-recovery-20260727/initial-stashes.txt`
- `.ai-team/reports/hybrid-recovery-20260727/initial-branch.txt`
- `.ai-team/reports/hybrid-recovery-20260727/initial-head.txt`

## Git 稽核

- `audit-git-status-short.txt`
- `audit-git-status.txt`
- `audit-working-diff.patch`
- `audit-cached-diff.patch`
- `audit-branches.txt`
- `audit-worktrees.txt`
- `audit-stashes.txt`
- `audit-reflog.txt`
- `audit-recent-log-safe-refs.txt`
- `audit-remotes-sanitized.txt`
- `change-inventory.json`

`git log --all` 因 5 個 broken Codex checkpoint refs 失敗；safe refs log 改用 branches/remotes/tags。

## WP-03 — Git checkpoint refs 稽核（2026-07-27）

- `.ai-team/reports/wp-03-git-checkpoint-refs-audit-20260727/preflight-git-state.txt`
- `.ai-team/reports/wp-03-git-checkpoint-refs-audit-20260727/ref-inventory.json`
- `.ai-team/reports/wp-03-git-checkpoint-refs-audit-20260727/git-fsck.txt`
- `.ai-team/reports/wp-03-git-checkpoint-refs-audit-20260727/source-analysis.md`
- `.ai-team/reports/wp-03-git-checkpoint-refs-audit-20260727/reviewer-verdict.md`

五個 ref 的 raw OID 都存在但皆為 tree；沒有同名 packed ref。預設 Windows Git 的真正阻塞是這五個 loose-file 絕對路徑皆為 260 字元，造成 `Filename too long`。唯讀、程序層級的 `core.longpaths=true` probe 已令五個 `show-ref` 與 `git log --all -1` 成功；沒有持久設定或 ref metadata 寫入。

## Session 與進度

- `.ai-team/reports/hybrid-recovery-20260727/codex-session-evidence-sanitized.json`
- `docs/codex-goal/PROGRESS.md`
- `docs/codex-goal/COMMAND_LOG.md`
- `docs/codex-goal/QUALITY_SCORECARD.md`
- `reports/manual-handoff/SOL_CURRENT_STATE.md`
- `reports/manual-handoff/SOL_FINDING_TRIAGE.md`
- `reports/manual-handoff/TERRA_TASK_PACKET.md`
- `reports/night-review/20260725T194948Z/NIGHT_FINAL_REPORT.md`
- `reports/night-review/20260725T194948Z/CLOUD_FINAL_AUDIT.md`
- `reports/night-review/20260725T194948Z/GEMINI_COVERAGE_REVIEW.md`

Session 摘要只保留 CelebrateDeal、最後 agent message、Goal/Spark 與 quota evidence；未複製完整對話，未讀 `auth.json`。

## 外部工具

- `.ai-team/reports/hybrid-recovery-20260727/agy-diagnosis.md`
- `agy-fast-live-result.json`
- `agy-deep-live-result.json`
- `browser-qa-live-result.json`
- `browser-qa-fallback.png`
- `external-tools-status.md`

## 使用者層 AGY 設定備份

- `C:\Users\eden\Downloads\AI-Team-Migration-Backups\AGY-user-config-20260727-033656\manifest.json`
- `C:\Users\eden\Downloads\AI-Team-Migration-Backups\AGY-user-config-20260727-033656\sha256.txt`

## 本次驗證

- AI Team static/isolated：37/37
- lint：exit 0

## WP-04 — 無正式 env 的可信回歸基準（2026-07-27，完成）

- `.ai-team/reports/wp-04-regression-baseline-20260727155807-8d6acbd8/source-manifest.json`
- `.ai-team/reports/wp-04-regression-baseline-20260727155807-8d6acbd8/environment-safety.json`
- `.ai-team/reports/wp-04-regression-baseline-20260727155807-8d6acbd8/command-receipts.json`
- `.ai-team/reports/wp-04-regression-baseline-20260727155807-8d6acbd8/regression-summary.sanitized.json`
- `.ai-team/reports/wp-04-regression-baseline-20260727155807-8d6acbd8/preflight-source-state.txt`
- `.ai-team/reports/wp-04-regression-baseline-20260727155807-8d6acbd8/postflight-source-state.txt`
- `.ai-team/logs/wp-04/20260727155807-8d6acbd8/`

最終 receipt：`npm ci`、secret scan、Prisma validate/generate/migrate deploy/status、lint、typecheck、strict-index、116 files／923 tests coverage、build、Playwright discovery（39 tests）及 schema cleanup 全數 exit 0。來源 `.env*` 內容未讀取；snapshot 與本次 `wp04_*` schema 已清除。
- typecheck：exit 0
- no-dotenv file-only Vitest：2 files、5 tests、exit 0
- Browser fallback：第 2 次 pass

完整 unit/build/E2E/Prisma 沒有執行，原因見 `manual-blockers.md`。

## WP-04 — 無正式 env 的可信回歸基準（2026-07-27，部分阻擋）

- `.ai-team/reports/wp-04-regression-baseline-20260727151211-6ac351eb/preflight-source-state.txt`
- `.ai-team/reports/wp-04-regression-baseline-20260727151211-6ac351eb/source-manifest.json`
- `.ai-team/reports/wp-04-regression-baseline-20260727151211-6ac351eb/environment-safety.json`
- `.ai-team/reports/wp-04-regression-baseline-20260727151211-6ac351eb/command-receipts.json`
- `.ai-team/reports/wp-04-regression-baseline-20260727151211-6ac351eb/regression-summary.sanitized.json`
- `.ai-team/reports/wp-04-regression-baseline-20260727151211-6ac351eb/gemini-fast-qa.json`
- `.ai-team/reports/wp-04-regression-baseline-20260727151211-6ac351eb/postflight-source-state.txt`
- `docs/launch/current-snapshot-regression-baseline.md`

此 run 未讀取任何 `.env*` 內容，`npm ci` exit 0；loopback disposable DB probe 因 `celebratedeal_ci` 不存在而 exit 1。後續 gate 全數正確標為 `BLOCKED_BY_TEST_INFRA`。

## WP-06 — Candidate migration DB Review（2026-07-28，REWORK_REQUIRED）

- `.ai-team/reports/wp-06-migration-review-20260727163722-a1e8affb/candidate-manifest.json`
- `.ai-team/reports/wp-06-migration-review-20260727163722-a1e8affb/aggregate-results.sanitized.json`
- `.ai-team/reports/wp-06-migration-review-20260727163722-a1e8affb/migration-apply-receipts.sanitized.json`
- `.ai-team/reports/wp-06-migration-review-20260727163722-a1e8affb/backfill-receipts.sanitized.json`
- `.ai-team/reports/wp-06-migration-review-20260727163722-a1e8affb/rollback-forward-plan.md`
- `.ai-team/reports/wp-06-migration-review-20260727163722-a1e8affb/review-verdict.md`
- `.ai-team/reports/wp-06-migration-review-20260727163722-a1e8affb/final-review-summary.sanitized.json`
- `.ai-team/reports/wp-06-migration-review-20260727163722-a1e8affb/gemini-deep-result.sanitized.json`
- `.ai-team/reports/wp-06-migration-review-20260727163722-a1e8affb/preflight-source-state.txt`
- `.ai-team/reports/wp-06-migration-review-20260727163722-a1e8affb/postflight-source-state.txt`
- `.ai-team/logs/wp-06/20260727163722-a1e8affb/`

所有 evidence 均為 synthetic local run；來源 `.env*` 沒有讀取，四個 `wp06_*` schemas 與 temporary workspace 已清理。

## WP-09 — AI Team runtime／工具政策第一切片（2026-07-28，COMPLETE）

- `.ai-team/reports/wp-09-change-batch-ai-team-20260728123215-521/preflight.md`
- `.ai-team/reports/wp-09-change-batch-ai-team-20260728123215-521/target-manifest.md`
- `.ai-team/reports/wp-09-change-batch-ai-team-20260728123215-521/dependency-map.md`
- `.ai-team/reports/wp-09-change-batch-ai-team-20260728123215-521/runtime-exclusion-list.md`
- `.ai-team/reports/wp-09-change-batch-ai-team-20260728123215-521/policy-gate-receipts.md`
- `.ai-team/reports/wp-09-change-batch-ai-team-20260728123215-521/gemini-fast-qa.sanitized.md`
- `.ai-team/reports/wp-09-change-batch-ai-team-20260728123215-521/postflight.md`
- `.ai-team/reports/wp-09-change-batch-ai-team-20260728123215-521/final-verdict.md`

來源 `.env*` 內容未讀取；靜態 gates 在 disposable no-dotenv snapshot 或唯讀 Git gate 執行。Fast QA 的底層程序 exit 0，但 wrapper 對 `REWORK_REQUIRED` 字樣誤標 `LOGIN_REQUIRED`；sanitized evidence 已保留並由主 Codex 以現況 `.gitignore` 與 dependency map 驗證。

## WP-12 — Bank key lifecycle remediation（2026-07-28）

- `.ai-team/reports/wp-12-bank-key-lifecycle-20260728012418-235/sanitized-summary.md`
- `.ai-team/reports/wp-12-bank-key-lifecycle-20260728012418-235/migration-receipts.json`
- `.ai-team/reports/wp-12-bank-key-lifecycle-20260728012418-235/key-version-tests.json`
- `.ai-team/reports/wp-12-bank-key-lifecycle-20260728012418-235/key-rotation-tests.json`
- `.ai-team/reports/wp-12-bank-key-lifecycle-20260728012418-235/old-key-recovery-tests.json`
- `.ai-team/reports/wp-12-bank-key-lifecycle-20260728012418-235/gemini-deep-result.sanitized.json`
- `.ai-team/reports/wp-12-bank-key-lifecycle-20260728012418-235/rollback-or-forward-fix.md`

此 run 未讀取來源 `.env*`、僅使用 loopback disposable schema 與 process-only synthetic keyring；schema cleanup PASS。

### WP-12 build-gate retry（完成）

- `.ai-team/reports/wp-12-bank-key-lifecycle-20260728015054-733/build-env-diagnosis.md`
- `.ai-team/reports/wp-12-bank-key-lifecycle-20260728015054-733/build-receipt.sanitized.json`
- `.ai-team/reports/wp-12-bank-key-lifecycle-20260728015054-733/build-log.sanitized.txt`
- `.ai-team/reports/wp-12-bank-key-lifecycle-20260728015054-733/cleanup-verification.txt`
- `.ai-team/reports/wp-12-bank-key-lifecycle-20260728015054-733/final-verdict.md`

Runner 以同一 `cmd setlocal` child process 傳入 synthetic build variables；preflight、Prisma generate 與 `npm run build` 均 PASS，沒有載入來源 `.env*`。

## WP-13 — Commission identity/status remediation（2026-07-28）

- `.ai-team/reports/wp-13-commission-dedup-status-20260728032314-106/migration-receipts.sanitized.json`
- `.ai-team/reports/wp-13-commission-dedup-status-20260728032314-106/final-verdict.md`
- `.ai-team/reports/wp-13-commission-dedup-status-20260728032100253/legacy-fixture-results.sanitized.json`
- `.ai-team/reports/wp-13-commission-dedup-status-20260728032100253/schema-cleanup.sanitized.json`
- `.ai-team/reports/wp-13-commission-dedup-status-20260728024622-953/gemini-deep-result.sanitized.json`

所有資料皆為 local disposable fixtures；無 `.env*` 內容、正式資料或正式服務輸入。`wp13_*` schema 均以 marker gate 清理。

## WP-14 — Commission accounting ledger（2026-07-28，COMPLETE）

- `.ai-team/reports/wp14-commission-accounting-20260728050645-915/migration-receipts.sanitized.json`
- `.ai-team/reports/wp14-commission-accounting-20260728050645-915/opening-balance-results.sanitized.json`
- `.ai-team/reports/wp14-commission-accounting-20260728050645-915/constraint-trigger-catalog.sanitized.json`
- `.ai-team/reports/wp14-commission-accounting-20260728050645-915/accounting-idempotency-results.sanitized.json`
- `.ai-team/reports/wp14-commission-accounting-20260728050645-915/paid-reversal-results.sanitized.json`
- `.ai-team/reports/wp14-commission-accounting-20260728050645-915/dispute-lifecycle-results.sanitized.json`
- `.ai-team/reports/wp14-commission-accounting-20260728050645-915/payout-transition-results.sanitized.json`
- `.ai-team/reports/wp14-commission-accounting-20260728050645-915/schema-cleanup.sanitized.json`
- `.ai-team/reports/wp14-commission-accounting-20260728050645-915/reviewer-verdict.md`
- `.ai-team/reports/wp14-commission-accounting-20260728050645-915/final-verdict.md`

所有 deterministic gate 已 PASS，資料只來自 synthetic、loopback disposable schema；source `.env*` 內容未讀取。登入恢復後 Fast／Deep sanitized 複核皆 PASS；Deep wrapper false positive 的 exit 0／PASS 原始事實已保存，故結論為 COMPLETE。

## WP-05 — Vendor Member Server Actions 拆分與 2300-line architecture gate（2026-07-28，COMPLETE）

- `.ai-team/reports/wp-05-vendor-member-actions-20260728054000-001/preflight-git-state.txt`
- `.ai-team/reports/wp-05-vendor-member-actions-20260728054000-001/target-manifest.json`
- `.ai-team/reports/wp-05-vendor-member-actions-20260728054000-001/line-count-before-after.json`
- `.ai-team/reports/wp-05-vendor-member-actions-20260728054000-001/public-export-contract.md`
- `.ai-team/reports/wp-05-vendor-member-actions-20260728054000-001/architecture-gate-result.json`
- `.ai-team/reports/wp-05-vendor-member-actions-20260728054000-001/targeted-tests.log`
- `.ai-team/reports/wp-05-vendor-member-actions-20260728054000-001/lint-typecheck-results.json`
- `.ai-team/reports/wp-05-vendor-member-actions-20260728054000-001/diff-check.txt`
- `.ai-team/reports/wp-05-vendor-member-actions-20260728054000-001/gemini-fast-result.sanitized.json`
- `.ai-team/reports/wp-05-vendor-member-actions-20260728054000-001/final-verdict.md`

來源 `.env*` 未讀取；完整 targeted suite 以 process-only synthetic keyring 通過 110/110。Gemini Fast 未實際啟動，因 wrapper 參數驗證而 `TOOL_BLOCKED`，不重試；它是本包 non-blocking QA，deterministic evidence 完整。

## WP-07 — Security 52 candidates triage（Authentication／MFA 第一切片，2026-07-28，COMPLETE）

- `.ai-team/reports/wp-07-auth-mfa-triage-20260728060121-511/raw-artifact-availability.md`
- `.ai-team/reports/wp-07-auth-mfa-triage-20260728060121-511/finding-matrix.md`
- `.ai-team/reports/wp-07-auth-mfa-triage-20260728060121-511/gemini-deep-review-attempt-3.sanitized.json`（使用者授權的例外第 3 次；AGY 在模型輸出前 soft-deny 未允許的 read-only Bash confirmation）
- `.ai-team/reports/wp-07-auth-mfa-triage-20260728060121-511/command-receipts.sanitized.json`
- `.ai-team/reports/wp-07-auth-mfa-triage-20260728060121-511/password-reset-db-results.md`
- `.ai-team/reports/wp-07-auth-mfa-triage-20260728060121-511/runner-safety.json`
- `.ai-team/reports/wp-07-auth-mfa-triage-20260728060121-511/schema-cleanup.json`
- `.ai-team/reports/wp-07-auth-mfa-triage-20260728060121-511/gemini-deep-review-result.sanitized.json`
- `.ai-team/reports/wp-07-auth-mfa-triage-20260728060121-511/reviewer-verdict.md`
- `.ai-team/reports/wp-07-auth-mfa-triage-20260728060121-511/gemini-deep-interactive-review.sanitized.json`
- `.ai-team/reports/wp-07-auth-mfa-triage-20260728060121-511/final-verdict.md`

第二次 runner 的 deterministic gates 全數 PASS；source `.env*` 未讀取，資料只在 loopback disposable `wp07_*` schema，已 marker 驗證後清除。MFA recovery code race 沒有 DB concurrency receipt，刻意維持 `INSUFFICIENT_EVIDENCE`；Gemini Deep 已在使用者互動授權下完成唯讀審查並回傳 `PASS`，故此第一切片最終 `COMPLETE`。
