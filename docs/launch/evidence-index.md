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

## WP-18 — Payout Batch PostgreSQL 併發 claim 證據閉環（2026-07-28，BLOCKED_BY_TEST_INFRA）

- `.ai-team/reports/wp-18-payout-batch-concurrency-20260728192659715/command-receipts.sanitized.json`
- `.ai-team/reports/wp-18-payout-batch-concurrency-20260728192659715/schema-cleanup.sanitized.json`
- `.ai-team/reports/wp-18-payout-batch-concurrency-20260728193607750/command-receipts.sanitized.json`
- `.ai-team/reports/wp-18-payout-batch-concurrency-20260728193607750/concurrency-outcome.sanitized.json`
- `.ai-team/reports/wp-18-payout-batch-concurrency-20260728193607750/runner-safety.json`
- `.ai-team/reports/wp-18-payout-batch-concurrency-20260728193607750/wp17-protected-manifest.json`
- `.ai-team/reports/wp-18-payout-batch-concurrency-20260728193607750/postflight-wp17-protected-manifest.json`
- `.ai-team/reports/wp-18-payout-batch-concurrency-20260728193607750/gemini-fast-result.sanitized.json`
- `.ai-team/reports/wp-18-payout-batch-concurrency-20260728193607750/final-verdict.md`

第二次 disposable runner 的 payout action targeted suite 為 3 files／110 tests PASS，且 core PostgreSQL race receipt 完整；coverage 則因既有 WP-17 DB test 缺少其專用 synthetic schema flag 而失敗。兩次 runner 均 marker cleanup PASS，沒有讀取來源 `.env*`。

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

## WP-17 — MFA recovery-code PostgreSQL concurrency（2026-07-28，COMPLETE）

- `.ai-team/reports/wp-17-mfa-recovery-concurrency-20260728184630752/command-receipts.sanitized.json`
- `.ai-team/reports/wp-17-mfa-recovery-concurrency-20260728184630752/concurrency-outcome.sanitized.json`
- `.ai-team/reports/wp-17-mfa-recovery-concurrency-20260728184630752/runner-safety.json`
- `.ai-team/reports/wp-17-mfa-recovery-concurrency-20260728184630752/schema-cleanup.sanitized.json`
- `.ai-team/reports/wp-17-mfa-recovery-concurrency-20260728184630752/gemini-fast-result.sanitized.json`
- `.ai-team/reports/wp-17-mfa-recovery-concurrency-20260728184630752/final-verdict.md`

兩個 `verifyMfaAction` readers 在 2 秒 fail-fast barrier 前都讀到同一 synthetic recovery row，隨後由真實 PostgreSQL conditional claim 產生一勝一敗；所有 deterministic gates 與 cleanup 均 PASS。來源 `.env*` 未讀取，沒有正式資料或服務輸入。Gemini Fast wrapper 在模型啟動前 TOOL_BLOCKED，屬 non-blocking QA。

## Git change batching（2026-07-28）

- 外部安全備份：`C:\Users\eden\Downloads\AI-Team-Migration-Backups\CelebrateDeal-git-batching-20260728-130341`。
- 分類與 commit report：`.ai-team/reports/git-change-batching-20260728-133000/`。
- 已提交：`725c17a docs(launch): record verification evidence` 與 `893865c docs(launch): record change batching outcome`；其餘原始變更均維持未暫存並依報告分類。

## Git backlog liquidation continuation（2026-07-28）

- 新外部安全備份：`C:\Users\eden\Downloads\AI-Team-Migration-Backups\CelebrateDeal-git-backlog-liquidation-20260728-131914`。
- 續作報告：`.ai-team/reports/git-backlog-liquidation-20260728-134500/`。
- Lite MCP 6/6、lint、typecheck、WP-12 bank encryption 5/5、Prisma validate/generate 與 secret scan 皆有本次 receipts；WP-04 完整 runner 受終端時限阻擋，採用既有完整 receipt，未誤稱本次重跑成功。

## WP-16-GR-01 — TypeScript strict indexed access CI Gate（2026-07-28，NOT_READY）

- `.ai-team/reports/wp-16-gr-01-20260728-161709/final-verdict.md`
- `.ai-team/reports/wp-16-gr-01-20260728-161709/test-results.md`
- `.ai-team/logs/wp-16-gr-01/typecheck-after-prisma.log`
- `.ai-team/logs/wp-16-gr-01/strict-index-corrected.log`

本包未提交：clean snapshot 的一般與 strict-index typecheck 皆因既有範圍外 source/schema 問題失敗；lint PASS，secret scan 在 archive snapshot 無 Git metadata 時 BLOCKED。

## WP-16 Git 工作樹歸零結案（2026-07-28）

- 外部安全快照、inventory、測試輸出與 staged patch：`C:\Users\eden\Downloads\AI-Team-Migration-Backups\CelebrateDeal-git-zero-20260728-165539`。
- 隔離 DB schema：`wp16_git_zero_20260728_1715`（loopback Docker；未操作正式資料庫或原 `public` schema）。
- 最終 unit receipt：117 files／937 tests PASS；secret scan、lint、typecheck、strict-index、Prisma validate/generate 與 diff check PASS。
- 此結案紀錄優先於本文件舊有的 WP-16-GR-01 `NOT_READY` 證據；該證據保留為歷史脈絡。

## WP-19 — Coverage synthetic schema flag propagation（2026-07-28，COMPLETE）

- `docs/launch/wp19-coverage-synthetic-schema-20260728.md`
- `.ai-team/reports/wp-19-coverage-synthetic-schema-20260728213657260/command-receipts.sanitized.json`
- `.ai-team/reports/wp-19-coverage-synthetic-schema-20260728213657260/coverage-project-schema-identity.sanitized.json`
- `.ai-team/reports/wp-19-coverage-synthetic-schema-20260728213657260/schema-cleanup.sanitized.json`
- `.ai-team/reports/wp-19-coverage-synthetic-schema-20260728213657260/wp17-protected-manifest.json`
- `.ai-team/reports/wp-19-coverage-synthetic-schema-20260728213657260/postflight-wp17-protected-manifest.json`

新的 no-dotenv canonical run 已通過 WP-17 107 targeted tests、WP-18 110 targeted tests、119 files／939 tests coverage、Prisma、lint、typecheck、strict-index、secret scan 與 diff check；雙 synthetic schema 均 marker-gated cleanup PASS。TB-16 已 `RESOLVED`，WP-18 為 `COMPLETE`／其 payout race 限定為 `MITIGATED_CURRENT_SNAPSHOT`。過往 raw receipt 仍只保留歷史診斷用途，沒有被用作本次結案依據。

## WP-08 — Product Browser QA（2026-07-29，COMPLETE；38／1 為歷史）

- `docs/launch/wp08-product-browser-qa-20260728.md`
- `.ai-team/reports/wp-08-product-browser-qa-20260728140909347/environment-safety.json`
- `.ai-team/reports/wp-08-product-browser-qa-20260728140909347/command-receipts.sanitized.json`
- `.ai-team/reports/wp-08-product-browser-qa-20260728140909347/browser-qa-summary.md`
- `.ai-team/reports/wp-08-product-browser-qa-20260728140909347/final-verdict.md`
- `.ai-team/reports/wp-08-product-browser-qa-20260728140909347/preflight-git-state.json`
- `.ai-team/reports/wp-08-product-browser-qa-20260728140909347/postflight-git-state.json`

歷史 run `20260728140909347` 的 38 passed／1 failed 僅保留根因脈絡。canonical run `20260729050408559` 已通過 39 Browser tests、119 files／939 tests coverage（0 failed／0 skipped）、Prisma、lint、typecheck、strict-index、secret scan、source manifest與snapshot/runtime／三 schema cleanup；final summary SHA-256 為 `31E12C426FC8466A5A96B273C17BCD023C8511D60C6892969B752D01CA0D71CB`，schema cleanup SHA-256 為 `F6EE5BA0466933DDC5D0A06A031B6AD9B9ABA76073FDA3F2B3163896628421DB`。readiness已由Sol重評為63／45。

## WP-24 — Canonical security／authorization residual inventory（2026-07-29）

- `docs/launch/m2-security-authorization-inventory-20260729.md`
- `docs/ai-team/current-work-package.md`
- `docs/ai-team/master-execution-plan.md`

WP-24以current HEAD `8a78acd`完成純靜態inventory：27個route handlers、5個Server Action modules、50個textual exported async actions；20個具名歷史候選逐項重新分類，6個current authorization residuals與external/manual register分離。歷史52項中未具名的32項只標為`HISTORICAL_DETAIL_UNAVAILABLE`，沒有發明finding ID、位置或current verdict。

本WP沒有執行產品測試、runner、Codex Security、npm audit或外部工具，也沒有讀取`.env*`或正式資料。Lite Goal bootstrap因歷史WP-08 phase與頂層`complete`不一致而受阻，記為control-plane `TOOL_BLOCKED`，不影響文件型deterministic verdict。
## WP-192 — Staging alias propagation verification（2026-08-04，ACCEPT）

- `.ai-team/reports/wp192-staging-alias-propagation-verification.json`
- `.ai-team/reports/wp192-agy-fast-qa.json`
- `docs/ai-team/evidence/wp-192-staging-alias-propagation-verification.md`

WP-191 已證明 staging alias rollback／restore transition；WP-192 以一次 bounded read-only execution 再證明 exact latest Preview routing、direct／alias WP-187 source digest與login identity。Sol High `ACCEPT`：CAT09 `7.0→7.5`、總分`72.5→73.0`，`STAGING_ROLLBACK_GATE=CLOSED_FOR_STAGING`；`PRODUCTION_READY=false`。AGY Fast兩次逾時為`TOOL_BLOCKED`，未冒充QA通過。

## WP-193 — Fresh staging UX matrix（2026-08-04，ACCEPT／FAIL_CLOSED）

- `.ai-team/reports/wp193-staging-ux-matrix.json`
- `.ai-team/reports/wp193-agy-fast-qa.json`
- `docs/ai-team/evidence/wp-193-staging-ux-matrix.md`
- `scripts/qa/wp193-staging-ux-matrix-receipt.mjs`
- `scripts/qa/wp193-staging-ux-matrix-receipt.test.mjs`

Fresh staging version Gate 通過，精確對應 WP-187 Preview／READY deployment 與已核准 digest。Chrome 自動化隨後被已開啟的 extension UI 阻擋，因此依計畫立即 fail closed：Browser matrix `0/8`、Axe `NOT_STARTED`、authenticated session `UNVERIFIED`，未重試或改用其他瀏覽器。Deterministic receipt tests `5/5`、ESLint、TypeScript、strict readback／text scan、diff-check與staged-empty皆PASS；AGY Fast兩次逾時為`TOOL_BLOCKED`。Sol High `ACCEPT`此安全停止結果；CAT06維持7.0、總分維持73.0，不宣稱staging UX QA通過。

## WP-194 — Chrome control re-verification（2026-08-04，ACCEPT／FAIL_CLOSED）

- `.ai-team/reports/wp194-staging-ux-matrix.json`
- `.ai-team/reports/wp194-agy-fast-qa.json`
- `docs/ai-team/evidence/wp-194-staging-ux-matrix.md`
- `scripts/qa/wp194-staging-ux-matrix-receipt.mjs`
- `scripts/qa/wp194-staging-ux-matrix-receipt.test.mjs`

Fresh staging version Gate再次通過。Chrome binding可用，但唯一new-tab staging navigation發生CDP `Page.navigate` timeout；依Sol計畫未重試、未fallback、未操作extension，並成功finalize。Matrix `0/8`、Axe `NOT_STARTED`、auth `UNVERIFIED`；所有禁止操作與敏感資料存取為0。Receipt tests `5/5`、ESLint、TypeScript、strict readback、sanitized evidence scan、diff-check與staged-empty PASS。AGY Fast兩次後`TOOL_BLOCKED`且無verdict；Sol High `ACCEPT`安全fail-closed結案，CAT06維持7.0、total維持73.0。

## WP-195 — Five-owner launch acceptance packet（2026-08-04，ACCEPT）

- `docs/launch/wp195-launch-owner-acceptance-contract.json`
- `scripts/wp195-launch-owner-acceptance-fixtures.json`
- `scripts/wp195-launch-owner-acceptance.mjs`
- `scripts/wp195-launch-owner-acceptance.test.mjs`
- `.ai-team/reports/wp195-launch-owner-acceptance.json`
- `.ai-team/reports/wp195-agy-fast-qa.json`
- `docs/ai-team/evidence/wp-195-launch-owner-acceptance.md`

WP-195新增跨merchant、support、finance、privacy-legal、release五owner的exact acceptance matrix、15責任檢查、evidence schema與go/no-go aggregation。唯一offline synthetic dry-run 12/12 scenarios與tests7/7、ESLint、TypeScript、strict readback、sanitized scan、diff-check、staged-empty均PASS；外部side effects與敏感資料存取為0。AGY Fast兩次FIRST_OUTPUT_TIMEOUT後`TOOL_BLOCKED`；Sol High `ACCEPT`新鮮商業流程coverage，CAT10 `4.0→4.5`、total `73.0→73.5`。Manual signatures=`PENDING`、release=`HOLD_NOT_READY`、overall=`NOT_READY`、Production ready=false。
## WP-196 — Final staging DB／PayUni Sandbox authorization attempt（2026-08-04，NO-GO／待 Sol acceptance）

- `scripts/wp196-final-staging-payuni-readonly-reconciliation-runner.mjs`
- `scripts/wp196-final-staging-payuni-readonly-reconciliation-runner.test.mjs`
- `.ai-team/reports/wp196-final-staging-payuni-authorization-receipt.json`
- `.ai-team/reports/wp196-agy-fast-qa.json`
- `.ai-team/reports/wp196-sol-acceptance.json`
- `docs/ai-team/evidence/wp-196-final-staging-payuni-authorization.md`

唯一 live attempt 在 parent binding presence preflight 以 `WP196_FINAL_NO_GO_BINDING` fail closed：
偵測到 4 個受控 target key 已存在於 process environment，因此 broker、staging DB、
candidate SELECT 與 PayUni query 皆為 0。Receipt 為 sanitized、strict readback PASS，
`FINAL_ATTEMPT_CONSUMED_NO_RERUN`、`FINAL_NO_SCORE_AUTHORIZATION`；CAT04 維持 6.0、
total 維持 73.5，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。AGY Fast 兩次
`FIRST_OUTPUT_TIMEOUT`，如實標記 `TOOL_BLOCKED`，不取代 deterministic evidence。Sol High
`ACCEPT` 僅接受安全 fail-closed no-go，不代表商業 reconciliation 成功。
低於 7.5 的 CAT04、CAT06、CAT10 目前分別等待受控 binding lineage、Chrome 外部狀態與
真人 owner／法務／客服／release 簽核；Goal 狀態為 `WAITING_AUTHORIZATION`，不再自動重跑。
## WP-197 — Staging lineage／Preview binding value-free gate（2026-08-04，NO-GO／待 Sol acceptance）

- `scripts/wp197-staging-lineage-binding-gate.mjs`
- `scripts/wp197-staging-lineage-binding-gate.test.mjs`
- `.ai-team/reports/wp197-staging-lineage-binding-gate.json`
- `.ai-team/reports/wp197-agy-fast-qa.json`
- `.ai-team/reports/wp197-sol-acceptance.json`
- `docs/ai-team/evidence/wp-197-staging-lineage-binding-gate.md`

Fresh Vercel metadata observation 發現 staging alias 為 Preview／READY、非 Production，但
不匹配 WP-196 期待 deployment。WP-197 唯一 live attempt 隨後在 parent contamination gate
以 `TERMINAL_NO_GO_CONTAMINATION` fail closed；inspect、probe、DB、PayUni 與 mutation 全為0。
Tests5/5、ESLint、TypeScript、strict readback、diff-check、staged-empty PASS；AGY Fast兩次
`FIRST_OUTPUT_TIMEOUT`=`TOOL_BLOCKED`。CAT04／total維持6.0／73.5，禁止重跑或另拆 retry WP。
Sol High `ACCEPT` 僅接受安全 no-go，不代表 staging／PayUni readiness；Goal 維持
`WAITING_AUTHORIZATION`，唯一缺口是修正 staging parent target-name metadata／routing contamination。

## FIN-09 — Partial-refund commission／settlement／unpaid payout closure（2026-08-07，LOCAL FUNCTIONAL CANDIDATE）

- `.ai-team/reports/fin09-partial-refund-settlement-closure.json`
- `docs/ai-team/evidence/fin-09-partial-refund-settlement-closure.md`
- `.ai-team/reports/wp-19-coverage-synthetic-schema-20260807045035242/command-receipts.sanitized.json`
- `.ai-team/reports/wp-19-coverage-synthetic-schema-20260807045035242/schema-cleanup.sanitized.json`

FIN-09 修正部分退款後 commission 被錯誤 void、settlement 使用 source amount 而非 ledger net，以及未付款 locked AffiliatePayout 未下降的 P1 財務缺口。FINANCE deterministic cohort 為 12 files／291 passed，Node TAP 566/566、typecheck、strict-index、ESLint、diff-check PASS；disposable PostgreSQL wp17／wp18 migration/status、targeted tests 150+153、cleanup 與 protected hashes PASS；production dependency audit 無 vulnerability。Coverage receipt 保留 `FAIL_REMAINING_SOURCE_INVENTORY`（546/566 pass、20 個既有 historical preview/staging fixture failures），沒有修改 threshold、assertion、skip 或 exclude。此 checkpoint 只證明本地產品功能候選閉環；staging／PayUni evidence 未取得，因此 CAT04 維持 6.0、總分維持 73.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## QUAL-02 — Global coverage source attribution（2026-08-07，FAIL_REMAINING_SOURCE_INVENTORY）

- `.ai-team/reports/qual02-global-coverage-source-attribution.json`
- `docs/ai-team/evidence/qual-02-global-coverage-source-attribution.md`
- `scripts/run-combined-coverage.mjs`
- `vitest.config.ts`

既有 global coverage gate 實際執行為 Vitest 167 files／1241 tests，1241 passed、0 failed；合併 Node TAP 後 global statements／branches／functions／lines 為 35.89／42.39／43.12／54.39，門檻仍為 63／57／60／65。Source split 顯示 `src/**` 已達 82.28／75.43／82.50／84.56，主要缺口在既有 `scripts/**` inventory 的 24.15／32.94／28.28／40.73。這輪沒有降低 threshold、擴大 exclude、加入 skip 或弱化 assertion；下一個工作包只補可追溯且有驗收價值的 deterministic tests。

## CAT10-01 — Commercial documentation／support／legal／owner evidence reconciliation（2026-08-07，MANUAL PENDING）

- `.ai-team/reports/cat10-closure-20260807.json`
- `docs/ai-team/evidence/cat10-closure-20260807.md`
- `docs/ai-team/evidence/wp-122-merchant-onboarding-contract.md`
- `docs/ai-team/evidence/wp-175-sales-to-support-operational-rehearsal.md`
- `docs/ai-team/evidence/wp-195-launch-owner-acceptance.md`

重新執行 WP-122／123／175／195 的 local deterministic contracts，node:test 合計 36 passed、0 failed、0 skipped；這只證明 onboarding、客服／退款交接、observability contract 與 five-owner blocker aggregation 可重現。真人 merchant、support／finance SLA、privacy／terms／refund legal review、external monitoring delivery 與 release owner go/no-go 仍 pending，沒有新增簽名或分數。CAT10 維持 4.5、總分維持 73.5、`PRODUCTION_READY=false`。

## SEC-02 — 最新 production dependency audit（2026-08-07，PASS）

- `.ai-team/reports/sec02-dependency-audit-20260807.json`
- `docs/ai-team/evidence/sec-02-dependency-audit-20260807.md`

`npm audit --omit=dev --json` 的 info／low／moderate／high／critical／total 全部為 0，production dependencies=213。未執行 `audit fix`、`--force` 或任何 dependency mutation；此 receipt 只支持 dependency audit，不取代完整 security candidate validation 或 Production approval。

## CAT06-01 — Local accessibility／RWD／performance closure（2026-08-07，LOCAL PASS／STAGING PENDING）

- `.ai-team/reports/cat06-closure-20260807.json`
- `docs/ai-team/evidence/cat06-closure-20260807.md`
- `src/app/admin/billing/dashboard/page.tsx`
- `src/app/admin/billing/dashboard/page.test.tsx`

首次 local release a11y gate 為 7/8，定位到 `/admin/billing/dashboard` 的退款按鈕 contrast 與退款月份 input label P1，已修正並補 deterministic assertions。修正後 page test 2/2、Chromium a11y 8/8、performance 4/4、typecheck／lint PASS。WP-193／194 staging matrix 仍 0/8 fail-closed，沒有重試 Chrome blocker 或把 local 結果外推為 staging sign-off；CAT06 維持 7.0、總分維持 73.5。

## QUAL-03 — Deterministic script source attribution cohort（2026-08-07，FAIL_REMAINING_SOURCE_INVENTORY）

- `.ai-team/reports/qual03-global-coverage-source-attribution.json`
- `docs/ai-team/evidence/qual-03-global-coverage-source-attribution.md`
- `scripts/wp134-next-startup-error-mapper.test.mjs`
- `scripts/wp139-isolated-next-build-runner.test.mjs`
- `scripts/wp141-sanitized-build-boundary-runner.test.mjs`
- `scripts/wp155-public-unavailable-browser-runner.test.mjs`

新增可追溯的 path／diagnostic mapping、hermetic mirror、synthetic environment、marker metadata、receipt round-trip、cleanup 與 fail-closed preflight tests。`npm run test:coverage` 實際為 Vitest 167 files／1241 passed、Node TAP 581/581 passed；combined statements／branches／functions／lines 為 36.76／43.20／44.27／55.69，仍低於 63／57／60／65。未修改 coverage inventory、threshold、exclude、skip 或 assertion；CAT04=6.0、CAT10=4.5、總分=73.5。

## QUAL-04 — Deterministic script source attribution expansion（2026-08-07，FAIL_REMAINING_SOURCE_INVENTORY）

- `.ai-team/reports/qual04-global-coverage-source-attribution.json`
- `docs/ai-team/evidence/qual-04-global-coverage-source-attribution.md`
- `scripts/wp134-next-startup-error-mapper.test.mjs`
- `scripts/wp139-isolated-next-build-runner.test.mjs`
- `scripts/wp141-sanitized-build-boundary-runner.test.mjs`
- `scripts/wp153-public-unavailable-browser-runner.test.mjs`
- `scripts/wp155-public-unavailable-browser-runner.test.mjs`
- `scripts/payuni-sandbox-external-qa.test.mjs`

新增 WP134／WP139／WP141／WP153／WP155 與 PayUni QA helper 的 path、diagnostic、hermetic mirror、receipt、stream、preflight、closed-enum 與 bounded-timeout deterministic tests。`npm run test:coverage` 實際為 Vitest 167 files／1243 passed、Node TAP 584/584 passed、0 skipped；combined statements／branches／functions／lines 為 36.91／43.36／44.40／55.90，仍低於 63／57／60／65。未修改 coverage inventory、threshold、exclude、skip 或 assertion；CAT04=6.0、CAT10=4.5、總分=73.5。

## QUAL-05 — Hermetic runner source attribution expansion（2026-08-07，FAIL_REMAINING_SOURCE_INVENTORY）

- `.ai-team/reports/qual05-global-coverage-source-attribution.json`
- `docs/ai-team/evidence/qual-05-global-coverage-source-attribution.md`
- `scripts/wp144-hermetic-build-runner.test.mjs`
- `scripts/wp147-hermetic-next-build-runner.test.mjs`
- `scripts/wp149-public-unavailable-browser-runner.test.mjs`
- `scripts/wp151-public-unavailable-browser-runner.test.mjs`

新增 hermetic build sanitizer、mirror exclusion、marker、receipt lineage、network-deny、synthetic environment、sanitized stream、digest snapshot、metadata 與 receipt writer deterministic tests。`npm run test:coverage` 實際為 Vitest 167 files／1243 passed、Node TAP 597/597 passed、0 skipped；combined statements／branches／functions／lines 為 37.42／43.74／45.10／56.61，仍低於 63／57／60／65。未修改 coverage inventory、threshold、exclude、skip 或 assertion；CAT04=6.0、CAT10=4.5、總分=73.5。

## QUAL-06 — Public-unavailable runner source attribution expansion（2026-08-07，FAIL_REMAINING_SOURCE_INVENTORY）

- `.ai-team/reports/qual06-global-coverage-source-attribution.json`
- `docs/ai-team/evidence/qual-06-global-coverage-source-attribution.md`
- `scripts/wp133-public-unavailable-browser-runner.test.mjs`

新增 WP133 的 mirror filtering、required-input inspection、loopback ephemeral port、synthetic environment、fixture/config、source digest 與 cleanup deterministic tests。`npm run test:coverage` 實際為 Vitest 167 files／1243 passed、Node TAP 601/601 passed、0 skipped；combined statements／branches／functions／lines 為 37.56／43.85／45.44／56.82，仍低於 63／57／60／65。未修改 coverage inventory、threshold、exclude、skip 或 assertion；CAT04=6.0、CAT10=4.5、總分=73.5。

## QUAL-07 — No-dotenv/build-boundary source attribution expansion（2026-08-07，FAIL_REMAINING_SOURCE_INVENTORY）

- `.ai-team/reports/qual07-global-coverage-source-attribution.json`
- `docs/ai-team/evidence/qual-07-global-coverage-source-attribution.md`
- `scripts/wp124-no-dotenv-build-runner.mjs`
- `scripts/wp124-no-dotenv-build-runner.test.mjs`
- `scripts/wp125-no-dotenv-diagnostic-runner.mjs`
- `scripts/wp125-no-dotenv-diagnostic-runner.test.mjs`
- `scripts/wp126-build-boundary-audit-runner.mjs`
- `scripts/wp126-build-boundary-audit-runner.test.mjs`

新增 no-dotenv／build-boundary runner 的 import-safe main guard、allowlist／排除規則、artifact parser、digest/status、synthetic environment、diagnostic summary、path metadata 與 OS-temp fixture deterministic tests。`npm run test:coverage` 實際為 Vitest 167 files／1243 passed、Node TAP 609/609 passed、0 skipped；combined statements／branches／functions／lines 為 37.78／43.94／45.88／57.65，仍低於 63／57／60／65。未修改 coverage inventory、threshold、exclude、skip 或 assertion；CAT04=6.0、CAT10=4.5、總分=73.5。

## QUAL-08 — Temp-next lineage／generated-target source attribution expansion（2026-08-07，FAIL_REMAINING_SOURCE_INVENTORY）

- `.ai-team/reports/qual08-global-coverage-source-attribution.json`
- `docs/ai-team/evidence/qual-08-global-coverage-source-attribution.md`
- `scripts/wp137-temp-next-route-lineage-runner.mjs`
- `scripts/wp137-temp-next-route-lineage-runner.test.mjs`
- `scripts/wp138-generated-target-reference-resolver.mjs`
- `scripts/wp138-generated-target-reference-resolver.test.mjs`

新增 WP137／WP138 的 normalized path policy、OS-temp mirror copy／cleanup、digest、sanitized inventory 與 forbidden mirror boundary deterministic tests。`npm run test:coverage` 實際為 Vitest 167 files／1243 passed、Node TAP 614/614 passed、0 skipped；combined statements／branches／functions／lines 為 38.12／44.22／46.40／58.13，仍低於 63／57／60／65。`scripts/**` attribution 為 27.07／35.40／32.95／46.17，`src/**` 為 82.28／75.32／82.50／84.56。未修改 coverage inventory、threshold、exclude、skip 或 assertion；CAT04=6.0、CAT10=4.5、總分=73.5。

## QUAL-09 — Public partner unavailable-state source attribution expansion（2026-08-07，FAIL_REMAINING_SOURCE_INVENTORY）

- `.ai-team/reports/qual09-global-coverage-source-attribution.json`
- `docs/ai-team/evidence/qual-09-global-coverage-source-attribution.md`
- `scripts/wp128-public-partner-unavailable-state-runner.mjs`
- `scripts/wp128-public-partner-unavailable-state-runner.test.mjs`

WP128 新增 offline／loopback synthetic environment、create／cleanup fixture script shape 與 bounded child-process success/failure deterministic tests。`npm run test:coverage` 實際為 Vitest 167 files／1243 passed、Node TAP 617/617 passed、0 skipped；combined statements／branches／functions／lines 為 38.04／44.15／46.39／58.22，仍低於 63／57／60／65。`scripts/**` attribution 為 27.02／35.34／32.96／46.30，`src/**` 為 82.28／75.32／82.50／84.56。WP128 原本未被 attribution，納入 source inventory 後 global statements 由 38.12% 變為 38.04%，結果如實保留；未修改 coverage inventory、threshold、exclude、skip 或 assertion；CAT04=6.0、CAT10=4.5、總分=73.5。

## QUAL-10 — Temp-next type-generation boundary source attribution expansion（2026-08-07，FAIL_REMAINING_SOURCE_INVENTORY）

- `.ai-team/reports/qual10-global-coverage-source-attribution.json`
- `docs/ai-team/evidence/qual-10-global-coverage-source-attribution.md`
- `scripts/wp136-temp-next-type-generation-runner.mjs`
- `scripts/wp136-temp-next-type-generation-runner.test.mjs`

WP136 新增 mirror forbidden-path policy、mirror inspection、OS-temp cleanup、synthetic environment 與 source-integrity helper deterministic tests。`npm run test:coverage` 實際為 Vitest 167 files／1243 passed、Node TAP 620/620 passed、0 skipped；combined statements／branches／functions／lines 為 38.14／44.25／46.58／58.38，仍低於 63／57／60／65。`scripts/**` attribution 為 27.15／35.48／33.23／46.52，`src/**` 為 82.28／75.32／82.50／84.56；相較 QUAL-09，global 四項分別提升 0.10／0.10／0.19／0.16 個百分點。未修改 coverage inventory、threshold、exclude、skip 或 assertion；CAT04=6.0、CAT10=4.5、總分=73.5。
## FIN-10 — First-time platform plan billing-mode functional closure（2026-08-07，LOCAL FIX／EXTERNAL EVIDENCE PENDING）

- `.ai-team/reports/fin10-platform-plan-billing-mode-closure.json`
- `docs/ai-team/evidence/fin-10-platform-plan-billing-mode-closure.md`
- `src/app/(app)/billing/plans/actions.ts`
- `src/app/(app)/billing/plans/actions.test.ts`
- `src/lib/billing.ts`
- `src/lib/billing.test.ts`

修正首次選擇 BillingPlan 時 payment mode 錯誤預設為 `byo` 的本機 P0；現在首次選擇使用 `platform`，既有訂閱變更保留既有模式。plan action＋billing settlement targeted cohort 為 2 files／19 tests PASS、0 failed、0 skipped。CAT04 維持 6.0、總分維持 73.5，因 staging／PayUni 外部證據仍未完成；沒有執行 migration、外部付款或 Production 操作。

## FUNC-11 — Partner playback source-lineage closure（2026-08-07，LOCAL FIX／EXTERNAL EVIDENCE NOT APPLIED）

- `.ai-team/reports/func11-playback-source-lineage-closure.json`
- `docs/ai-team/evidence/func-11-playback-source-lineage-closure.md`
- `src/lib/team-funnel-public-page.ts`
- `src/lib/team-funnel-attribution.ts`
- `src/app/api/affiliate-clicks/route.ts`
- `src/components/live-playback.tsx`

修正 B 頁跳轉共享直播頁時遺失 source lineage 的 P1 功能缺口：播放 URL 現在保留 `sourcePage`／`ref`，click API 允許 source-only click，但仍以 vendor、live、公開頁與 active membership 做伺服器驗證。playback／attribution cohort 為 4 files／50 tests PASS，form-submissions compatibility 為 1 file／13 tests PASS；typecheck／ESLint PASS。後續 `npm run test:contracts` 為 620/620、`npm run release:verify:local` 為 verified、readiness reconciliation 為 PASS；CAT01 維持 7.5、CAT04 維持 6.0、總分維持 73.5；沒有執行 staging、PayUni、migration 或 Production 操作。

## FIN-11 — Course F/G allocation and refund ledger closure（2026-08-07，LOCAL FUNCTIONAL FIX／EXTERNAL EVIDENCE PENDING）

- `.ai-team/reports/fin11-course-fg-allocation-closure.json`
- `docs/ai-team/evidence/fin-11-course-fg-allocation-closure.md`
- `prisma/migrations/20260807080000_course_fg_allocation/migration.sql`
- `src/lib/course-commission.ts`
- `src/lib/course-commission-accounting.ts`
- `src/lib/course-payment-webhooks.test.ts`
- `src/app/actions/product-actions.ts`

完成課程商品 domain、F 直購 100%、實際 G only、immutable policy snapshot、paid webhook idempotency、partial/full refund ledger 與 dispute boundary；同時把 team conversion attribution 改為不可變 snapshot。完整 Vitest 為 170 files／1258 passed／0 failed／0 skipped，Node contracts 620/620，FIN-11＋payment targeted 44/44，checkout＋team＋playback targeted 63/63，typecheck／ESLint／Prisma validate／diff-check PASS。disposable loopback migration deploy 與 no-pending status PASS。第一次 disposable migration 的長 index 名稱碰撞已如實記錄並修正，沒有對 staging、Production 或正式 DB 套用。課程 merchant-owned payout/KYC/tax/人工 owner evidence 與 staging／PayUni 仍 pending，CAT04 維持 6.0、總分維持 73.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FIN-12 — Shared refund accounting closure（2026-08-07，LOCAL FUNCTIONAL FIX／EXTERNAL EVIDENCE PENDING）

- `.ai-team/reports/fin12-refund-accounting-closure.json`
- `docs/ai-team/evidence/fin-12-refund-accounting-closure.md`
- `src/lib/payment-refund-accounting.ts`
- `src/app/actions.ts`
- `src/lib/payment-webhooks.ts`
- `src/app/actions.test.ts`

finance-admin 本地退款、PayUni completion 與 webhook refund 現在共用同一個 Serializable refund accounting helper；affiliate 與課程 F/G payable ledger 的負向 entry 和 `RefundRecord`／`PaymentTransaction` 綁定同一 transaction commit，provider event／RefundRecord identity 可冪等去重，缺少 affiliate order identity 時 fail closed。targeted 3 files／187 tests、full Vitest 170 files／1259 tests、Node contracts 620/620、architecture／Prisma／payout contracts 8/8 均 PASS；typecheck、ESLint、local release verify、loopback disposable migration no-pending 也 PASS。CAT04=6.0、CAT06=7.0、CAT10=4.5、總分=73.5；staging／PayUni／Production 與人工法律／財務／release sign-off 仍 pending。

## FIN-13 — Course F/G merchant-owned payout read-model closure（2026-08-07，LOCAL FUNCTIONAL FIX／EXTERNAL EVIDENCE PENDING）

- `.ai-team/reports/fin13-course-payout-read-model-closure.json`
- `docs/ai-team/evidence/fin-13-course-payout-read-model-closure.md`
- `prisma/migrations/20260807100000_course_payout_read_model/migration.sql`
- `src/lib/course-payout-accounting.ts`
- `src/app/actions/course-payout-actions.ts`
- `src/app/admin/billing/course-payouts/page.tsx`

新增獨立 `CoursePayout` read model，settlement lock 從 immutable course ledger 依 recipient／month 冪等同步 pending payable；paid 需人工 reference 且 exact-match，void 追加 immutable reversal entries，所有 outcome audit logged，沒有外部付款副作用。課程 payout targeted 2 files／6 tests、architecture／Prisma／payout contracts 5 files／14 tests、full Vitest 172 files／1265 tests、Node contracts 620/620 PASS；typecheck、full ESLint（0 errors、2 個既有 warnings）、Prisma validate／generate、diff-check、16/16 disposable migration no-pending、release verify、dependency audit 0 vulnerabilities PASS。combined coverage 仍如實為 FAIL_REMAINING_SOURCE_INVENTORY：global 38.57／44.49／46.92／58.76 低於 63／57／60／65；未修改 threshold、inventory、exclude、skip 或 assertion。CAT04=6.0、CAT06=7.0、CAT10=4.5、總分=73.5；staging／PayUni／Production 與人工法律／財務／release sign-off 仍 pending。

## FIN-14 — Platform referral domain boundary and subscription attribution closure（2026-08-07，LOCAL DOMAIN BOUNDARY／PAYMENT CALLBACK PENDING）

- `.ai-team/reports/fin14-platform-referral-boundary-closure.json`
- `docs/ai-team/evidence/fin-14-platform-referral-boundary-closure.md`
- `prisma/migrations/20260807110000_platform_referral_attribution/migration.sql`
- `src/lib/platform-referral.ts`
- `src/app/r/[code]/route.ts`
- `src/app/(app)/billing/plans/actions.ts`

FIN-14 以獨立 `PlatformReferralCode`／`PlatformReferralClick`／`PlatformReferralAttribution` 完成平台方案推薦與商家 Affiliate 的 domain boundary；`/r/[code]` server-side click 與 HttpOnly cookie 只帶到 subscription attribution snapshot，沒有在尚未有 subscription payment callback 時虛構 commission／refund／payout。targeted 3 files／14 tests、inventory／architecture／Prisma／payout contracts 6 files／22 tests、full Vitest 174 files／1272 tests、Node contracts 620/620、API registry 29/29、17/17 disposable migration no-pending、typecheck／Prisma validate-generate／ESLint（0 errors、2 個既有 warnings）／diff-check PASS。最新 combined coverage 如實為 FAIL_REMAINING_SOURCE_INVENTORY：global 38.62／44.54／46.95／58.82 低於 63／57／60／65，scripts attribution 27.15／35.48／33.23／46.52，src attribution 81.87／74.66／82.25／84.36；未修改 threshold、inventory、exclude、skip 或 assertion。CAT04=6.0、CAT06=7.0、CAT10=4.5、總分=73.5；payment callback、staging／PayUni／Production 與人工法律／財務／release sign-off 仍 pending。

## QUAL-11 — Product action deterministic source attribution（2026-08-07，LOCAL TEST CLOSURE／GLOBAL COVERAGE PENDING）

- `.ai-team/reports/qual11-product-action-source-attribution.json`
- `docs/ai-team/evidence/qual-11-product-action-source-attribution.md`
- `src/app/actions/product-actions.ts`
- `src/app/actions/product-actions.test.ts`

QUAL-11 為商家／課程商品 action 補上 6 個 deterministic tests，覆蓋 merchant create、course owner／promoter share、immutable policy version、unsafe URL 與 CSRF boundary。targeted 1 file／6 tests、full Vitest 175 files／1278 tests、Node contracts 620/620、typecheck／full ESLint（0 errors、2 個既有 warnings）PASS。combined coverage global 38.75／44.73／47.06／59.03，仍低於 63／57／60／65；scripts attribution 27.15／35.48／33.23／46.52，src attribution 82.47／75.51／82.64／85.00。未修改 threshold、inventory、exclude、skip 或 assertion；CAT04=6.0、CAT06=7.0、CAT10=4.5、總分=73.5，外部與人工 release evidence 仍 pending。

## QUAL-12 — Team funnel template action source attribution（2026-08-07，LOCAL TEST CLOSURE／GLOBAL COVERAGE PENDING）

- `.ai-team/reports/qual12-team-funnel-template-source-attribution.json`
- `docs/ai-team/evidence/qual-12-team-funnel-template-source-attribution.md`
- `src/app/actions/team-funnel-template-actions.ts`
- `src/app/actions/team-funnel-template-actions.test.ts`

QUAL-12 補上 team funnel template action 的 create／publish success paths，驗證 source page、商品 slot、webinar lineage、版本發布與 ownership update。targeted 1 file／6 tests、full Vitest 175 files／1280 tests、Node contracts 620/620；combined coverage global 38.86／44.82／47.17／59.21，仍低於 63／57／60／65；scripts attribution 27.15／35.48／33.23／46.52，src attribution 83.00／75.90／83.02／85.57。未修改 threshold、inventory、exclude、skip 或 assertion；CAT04=6.0、CAT06=7.0、CAT10=4.5、總分=73.5，外部與人工 release evidence 仍 pending。

## FUNC-12 — Server-validated Stream usage attribution ledger（2026-08-07，LOCAL FUNCTIONAL FIX／EXTERNAL RECONCILIATION PENDING）

- `.ai-team/reports/func12-stream-usage-attribution-ledger.json`
- `docs/ai-team/evidence/func-12-stream-usage-attribution-ledger.md`
- `prisma/migrations/20260807130000_stream_usage_attribution_ledger/migration.sql`
- `src/lib/stream-usage.ts`
- `src/app/api/stream-usage/route.ts`
- `src/lib/stream-usage-client.ts`
- `src/components/live-playback.tsx`
- `src/lib/billing.ts`

FUNC-12 完成 server-validated immutable playback usage ledger：bounded heartbeat 會保存 live／page／team／promoter／content owner／month snapshot，`eventId` replay 不重複入帳，billing settlement 會讀取 ledger seconds 並與既有 vendor aggregate 做不重複計算。targeted 8 files／54 tests、full Vitest 178 files／1298 tests、Node contracts 620/620、API registry 30/30、Prisma 59 models／18/18 disposable migrations、typecheck／ESLint PASS。combined coverage 如實為 FAIL_REMAINING_SOURCE_INVENTORY：global 39.06／44.97／47.40／59.43，scripts 27.15／35.48／33.23／46.52，src 83.23／76.06／83.40／85.82，低於 63／57／60／65；未修改 threshold、inventory、exclude、skip 或 assertion。quota policy、provider reconciliation、staging／PayUni 與人工 release evidence 仍 pending；CAT04=6.0、CAT06=7.0、CAT10=4.5、總分=73.5，Goal 維持 IN_PROGRESS。

## FIN-15 — Platform referral verified payment callback and refund ledger closure（2026-08-07，LOCAL COMMISSION／REFUND CLOSURE／PAYOUT PENDING）

- `.ai-team/reports/fin15-platform-referral-commission-callback-closure.json`
- `docs/ai-team/evidence/fin-15-platform-referral-commission-callback-closure.md`
- `prisma/migrations/20260807150000_platform_referral_commission_ledger/migration.sql`
- `src/lib/platform-referral-commission.ts`
- `src/lib/payment-webhooks.ts`
- `src/lib/payment-webhooks.test.ts`

FIN-15 新增獨立 `PlatformReferralCommission`／append-only ledger；verified paid webhook 只有在既有 server-created pending `PaymentTransaction` 的 trusted `platformSubscriptionId` metadata 存在時才 accrual，provider payload 不能選 subscription／vendor／推薦人。partial/full refund 追加負向 ledger，full refund 將 commission 標記 `void`，重播與負餘額皆 fail closed；平台推薦不與 merchant `AffiliateCommission` 混用。targeted callback／commission 為 2 files／40 passed，inventory／architecture／payout contracts 3 files／5 passed，full Vitest 179 files／1304 passed／0 failed／0 skipped，Node contracts 620/620，API registry 30/30，Prisma inventory 61 models／19/19 disposable migrations，typecheck、Prisma validate/generate、full ESLint（0 errors、2 個既有 warnings）、local release verify、diff-check PASS。combined coverage 如實為 FAIL_REMAINING_SOURCE_INVENTORY：global 39.15／45.04／47.54／59.53，scripts 27.23／35.54／33.37／46.63，src 83.15／75.99／83.46／85.82，低於既有 63／57／60／65；未修改 threshold、inventory、exclude、skip 或 assertion。payout read model／batch、方案付款 initiation、staging／PayUni／Production 與人工法律／財務／release sign-off 仍 pending；CAT04=6.0、CAT06=7.0、CAT10=4.5、總分=73.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。FIN-08AA、WP-196、WP-197 未重試。

## FIN-16 — Platform referral payout read model／local batch／finance-admin outcome closure（2026-08-07，LOCAL PAYOUT／EXTERNAL TRANSFER PENDING）

- `.ai-team/reports/fin16-platform-referral-payout-read-model-batch-closure.json`
- `docs/ai-team/evidence/fin-16-platform-referral-payout-read-model-batch-closure.md`
- `prisma/migrations/20260807170000_platform_referral_payout_read_model/migration.sql`
- `src/lib/platform-referral-payout.ts`
- `src/app/actions/platform-referral-payout-actions.ts`
- `src/app/admin/billing/platform-referral-payouts/page.tsx`

FIN-16 新增獨立 `PlatformReferralPayout`／`PlatformReferralPayoutBatch`，按 immutable platform referral ledger 做 owner/month payable read model；sync 只更新 pending row，已 batched／paid／void 的 ledger drift 會 fail closed。finance-admin 可建立只存在本機的 payout batch，paid 必須 batch 後附人工 reference，void 會對每筆正餘額 commission 追加 immutable reversal 並寫 audit；不保存銀行 credential、不呼叫外部 provider。targeted payout／finance action 為 2 files／10 passed，full Vitest 181 files／1314 passed／0 failed／0 skipped，Node contracts 620/620，Prisma inventory 63 models／20/20 disposable migrations，typecheck、Prisma validate/generate、full ESLint（0 errors、2 個既有 warnings）、local release verify、diff-check PASS。combined coverage 如實為 FAIL_REMAINING_SOURCE_INVENTORY：global 39.30／45.09／47.64／59.67，scripts 27.23／35.54／33.37／46.63，src 82.82／75.55／83.32／85.69，低於既有 63／57／60／65；未修改 threshold、inventory、exclude、skip 或 assertion。實際方案付款 initiation、外部出款、KYC／稅務、staging／PayUni／Production 與人工法律／財務／release sign-off 仍 pending；CAT04=6.0、CAT06=7.0、CAT10=4.5、總分=73.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。FIN-08AA、WP-196、WP-197 未重試。

## FIN-17 — Platform subscription pending checkout／trusted activation closure（2026-08-07，LOCAL PAYMENT INITIATION／EXTERNAL EVIDENCE PENDING）

- `.ai-team/reports/fin17-platform-subscription-checkout-activation-closure.json`
- `docs/ai-team/evidence/fin-17-platform-subscription-checkout-activation-closure.md`
- `src/app/(app)/billing/plans/actions.ts`
- `src/app/(app)/billing/plans/page.tsx`
- `src/lib/payment-webhooks.ts`
- `scripts/wp175-sales-to-support-operational-rehearsal.mjs`

FIN-17 將方案選擇從付款前直接 `active` 改為 server-created `pending_payment` subscription／pending `PaymentTransaction`，以 trusted metadata 綁定 platform subscription 與 billing plan；provider checkout 支援 `BillingPlan` 顯示名稱，頁面只接受 allowlisted PayUni form action。paid webhook 只啟用既有可信交易指向的 pending subscription、更新 usage limit、結束舊方案且 replay idempotent；failed／full refund 分別標記 `payment_failed`／`payment_refunded`。targeted plan action／page 2 files／13 passed，payment webhook 39 passed，full Vitest 181 files／1316 passed／0 failed／0 skipped，Node contracts 620/620，WP-175 targeted 4/4，typecheck／ESLint／local release verify／diff-check PASS。combined coverage 如實為 FAIL_REMAINING_SOURCE_INVENTORY：global 39.35／45.10／47.61／59.67，scripts 27.15／35.48／33.23／46.52，src 82.58／75.05／82.96／85.40，低於既有 63／57／60／65；未修改 threshold、inventory、exclude、skip 或 assertion。PayUni Sandbox／staging／Production、外部出款、KYC／稅務與人工法律／財務／release sign-off 仍 pending；CAT04=6.0、CAT06=7.0、CAT10=4.5、總分=73.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。FIN-08AA、WP-196、WP-197 未重試。

## CAT06-LOCAL-01 — Local Browser Accessibility／Responsive／Performance Matrix（2026-08-07，LOCAL EVIDENCE／STAGING PENDING）

- `.ai-team/reports/cat06-local-browser-qa-2026-08-07.json`
- `docs/ai-team/evidence/cat06-local-browser-qa-2026-08-07.md`
- `tests/e2e/accessibility.spec.ts`
- `tests/e2e/performance.spec.ts`
- `playwright.config.ts`

CAT06 local release-mode browser matrix 已完成：`npm run e2e:a11y` 8/8 passed、`npm run e2e:performance` 4/4 passed，涵蓋 Axe critical／serious、keyboard focus／skip link、reduced-motion、390×844 mobile overflow／touch target 與公開／authenticated performance budgets。這只強化 local evidence，CAT06 維持 7.0；staging desktop／mobile、PayUni／external monitoring 與人工 release owner evidence 仍 pending，CAT04=6.0、CAT06=7.0、CAT10=4.5、總分=73.5，Goal 維持 IN_PROGRESS。

## CAT10-LOCAL-01 — Onboarding／Support／Policy／Monitoring／Owner Evidence（2026-08-07，LOCAL EVIDENCE／MANUAL AND EXTERNAL PENDING）

- `.ai-team/reports/cat10-local-operational-owner-evidence-2026-08-07.json`
- `docs/ai-team/evidence/cat10-local-operational-owner-evidence-2026-08-07.md`
- `scripts/wp122-merchant-onboarding-validator.mjs`
- `scripts/wp123-observability-rehearsal.mjs`
- `scripts/wp175-sales-to-support-operational-rehearsal.mjs`
- `scripts/wp195-launch-owner-acceptance.mjs`
- `docs/operations/merchant-onboarding-readiness-runbook.md`
- `docs/operations/payment-refund-support-incident-sop.md`

CAT10 local deterministic contract 40/40 passed／0 failed／0 skipped：WP-122 onboarding 8 stages／6 roles、WP-123 monitoring incident rehearsal、WP-175 sales→support handoff、WP-195 exact five-owner／12-scenario fail-closed acceptance matrix。manual merchant rehearsal、客服 owner SLA、法務／隱私／退款政策、外部 telemetry、staging／DNS／PayUni 與 release owner acceptance 仍 pending；CAT10 維持 4.5、CAT04=6.0、CAT06=7.0、總分=73.5，Goal 維持 IN_PROGRESS。

## SEC-2026-08-07-01 — Latest Dependency Audit（2026-08-07，DEPENDENCY PASS／SECRET INVENTORY PENDING）

- `.ai-team/reports/sec-2026-08-07-dependency-audit.json`
- `docs/ai-team/evidence/sec-2026-08-07-dependency-audit.md`
- `package.json`
- `package-lock.json`

初始 dependency audit 的 `js-yaml` 4.3.0 high 已以最小 `overrides` pin 到 4.3.1；最終 `npm audit` 0 vulnerabilities、`npm ls` 正常，full Vitest 181/1316、Node contracts 620/620。獨立 `npm run secret:scan` 仍回報 47 個 `external_database_url` 分類，未刪除或弱化 inventory；CAT 分數不變，Goal 維持 IN_PROGRESS。
## QUAL-2026-08-07-01 — secret-scan source attribution and latest coverage

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-secret-scan-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-secret-scan-source-attribution.json`
- Result: `PARTIAL_CLOSURE`; full Vitest `181 files / 1317 passed`, Node contracts `620 passed`, targeted secret-scan tests `5 passed`.
- `npm run secret:scan` still has `47 external_database_url` findings; no raw source values were emitted and no inventory/exclusion/assertion was weakened.
- Latest global coverage remains below the existing `63/57/60/65` thresholds: `39.35/45.10/47.61/59.67`; no score uplift and Goal remains `IN_PROGRESS`.
## SEC-2026-08-07-02 — secret-scan controlled fixture inventory closure

- Evidence: `docs/ai-team/evidence/sec-2026-08-07-secret-inventory-closure.md`
- Report: `.ai-team/reports/sec-2026-08-07-secret-inventory-closure.json`
- Result: `COMPLETE_LOCAL_SECURITY_CLOSURE`; `npm run secret:scan` now passes with 0 findings after source-specific fixture remediation.
- Regression evidence: full Vitest `181/1317`, Node contracts `620/620`, targeted preflight/database identity `9/9`, dependency audit `0 vulnerabilities`, typecheck/lint/release verify/diff-check pass.
- Coverage remains `FAIL_REMAINING_SOURCE_INVENTORY` at global `39.35/45.10/47.61/59.67` against unchanged `63/57/60/65`; no score uplift and Goal remains `IN_PROGRESS`.
## QUAL-2026-08-07-02 — WP156 cleanup/state source-attribution tests

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-wp156-cleanup-coverage.md`
- Report: `.ai-team/reports/qual-2026-08-07-wp156-cleanup-coverage.json`
- Result: targeted WP156 `12/12` and Node contracts `622/622` pass; global coverage remains `FAIL_REMAINING_SOURCE_INVENTORY` at `39.35/45.10/47.61/59.67` against unchanged `63/57/60/65`.
- No threshold, exclusion, inventory, skip, assertion or score was changed; Goal remains `IN_PROGRESS`.
## CAT04-2026-08-07-01 — PayUni Sandbox external QA probe

- Evidence: `docs/ai-team/evidence/cat04-2026-08-07-payuni-sandbox-probe.md`
- Report: `.ai-team/reports/cat04-2026-08-07-payuni-sandbox-probe.json`
- Result: sanitized external QA failure; checkout/provider/refund reconciliation gates remain unproven and CAT04 stays `6.0`.
- Same-command retry is prohibited for this package; no FIN-08AA/WP-196/WP-197 retry and no score uplift.

## CAT10-LOCAL-02 — Public policy, support and merchant onboarding entrypoints

- Evidence: `docs/ai-team/evidence/cat10-local-public-entrypoints-2026-08-07.md`
- Report: `.ai-team/reports/cat10-local-public-entrypoints-2026-08-07.json`
- Result: `/policies`, terms/privacy/refund draft pages, `/support` SLA draft and `/merchant-onboarding` eight-stage handoff are renderable and linked from login/AppShell; targeted `17/17`, full Vitest `1327/1327`, Node contracts `622/622`, typecheck, lint and secret scan pass.
- All pages remain explicitly draft／human acceptance required. Real merchant rehearsal, support／finance SLA acceptance, legal/privacy/terms/refund review, external monitoring and release owner go/no-go remain pending; CAT10 stays `4.5`, total stays `73.5`, Goal remains `IN_PROGRESS`.

## QUAL-2026-08-07-03 — WP153 loopback source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-wp153-loopback-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-wp153-loopback-source-attribution.json`
- Result: loopback URL userinfo is now rejected fail-closed; targeted WP153 `18/18`, full Vitest `1327/1327`, Node contracts `625/625` pass.
- Combined coverage improved to `39.42/45.15/47.80/59.74` but remains below unchanged `63/57/60/65`; no threshold/exclude/skip/assertion weakening, no score uplift, CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`.

## QUAL-2026-08-07-04 — Coverage source inventory diagnostic

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-04-coverage-inventory-diagnostic.md`
- Report: `.ai-team/reports/qual-2026-08-07-04-coverage-inventory-diagnostic.json`
- Result: read-only inspection of the existing coverage summary; global `39.42/45.15/47.80/59.74` remains below unchanged `63/57/60/65`. Approximate remaining covered units are statements `7,211`, branches `2,939`, functions `575`, lines `929`.
- This diagnostic has no score impact. It does not substitute for CAT04 provider evidence or CAT10 human acceptance; no external route, FIN-08AA, WP-196 or WP-197 was retried.

## QUAL-2026-08-07-05 — WP153 deterministic subprocess/readiness source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-05-wp153-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-05-wp153-source-attribution.json`
- Result: targeted `node:test` `21/21` passed, targeted WP153 coverage is lines `64.62%`, branches `81.94%`, functions `78.57%`; scoped ESLint and diff-check pass.
- Global coverage was not recomputed in this package; the last authoritative global result remains `39.42/45.15/47.80/59.74` against unchanged `63/57/60/65`. No score uplift; CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`.

## QUAL-2026-08-07-06 — WP155 deterministic subprocess/readiness source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-06-wp155-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-06-wp155-source-attribution.json`
- Result: targeted `node:test` `18/18` passed, WP155 source-entry process coverage is lines `55.79%`, branches `73.24%`, functions `71.43%`; scoped ESLint and diff-check pass.
- Global coverage was not recomputed; last authoritative global remains `39.42/45.15/47.80/59.74` against unchanged `63/57/60/65`. No score uplift; CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`.

## QUAL-2026-08-07-07 — WP149 deterministic subprocess/readiness source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-07-wp149-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-07-wp149-source-attribution.json`
- Result: targeted `node:test` `12/12` passed, WP149 source-entry process coverage is lines `65.29%`, branches `70.33%`, functions `80.77%`; scoped ESLint and diff-check pass. Browser orchestration and `main` were not executed.
- Global coverage was not recomputed; last authoritative global remains `39.42/45.15/47.80/59.74` against unchanged `63/57/60/65`. No score uplift; CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`.

## QUAL-2026-08-07-08 — WP151 deterministic subprocess/readiness source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-08-wp151-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-08-wp151-source-attribution.json`
- Result: targeted `node:test` `16/16` passed, WP151 source-entry process coverage is lines `61.61%`, branches `77.66%`, functions `80.77%`; scoped ESLint and diff-check pass. Browser orchestration and `main` were not executed.
- Global coverage was not recomputed; last authoritative global remains `39.42/45.15/47.80/59.74` against unchanged `63/57/60/65`. No score uplift; CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`.

## QUAL-2026-08-07-09 — FIN-08 legacy pure-helper source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-09-fin08-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-09-fin08-source-attribution.json`
- Result: targeted `node:test` `8/8` passed, FIN-08 target source-entry process coverage is lines `43.23%`, branches `84.42%`, functions `60.00%`; scoped ESLint and diff-check pass.
- This package covered pure helpers only; live FIN-08 staging/PayUni execution and FIN-08AA route-manifest attestation were not executed or retried. Imported WP174 coverage is not claimed as target progress.
- Global coverage was not recomputed; last authoritative global remains `39.42/45.15/47.80/59.74` against unchanged `63/57/60/65`. No score uplift; CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`.

## QUAL-2026-08-07-10 — WP170 deterministic staging PayUni read-only source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-10-wp170-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-10-wp170-source-attribution.json`
- Result: targeted `node:test` `17/17` passed, WP170 source-entry process coverage is lines `58.99%`, branches `86.86%`, functions `76.00%`; scoped ESLint and diff-check pass.
- Pure logic only: live runner, staging, database, Browser and PayUni were not executed. Global coverage was not recomputed; last authoritative global remains `39.42/45.15/47.80/59.74` against unchanged `63/57/60/65`.
- No score uplift; CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`. FIN-08AA, WP-196 and WP-197 were not retried.

## QUAL-2026-08-07-11 — WP168 deterministic staging PayUni reconciliation source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-11-wp168-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-11-wp168-source-attribution.json`
- Result: targeted `node:test` `12/12` passed, WP168 source-entry process coverage is lines `68.15%`, branches `91.40%`, functions `76.92%`; scoped ESLint and diff-check pass.
- Pure logic only: live staging, database, Browser and PayUni were not executed. Global coverage was not recomputed; last authoritative global remains `39.42/45.15/47.80/59.74` against unchanged `63/57/60/65`.
- No score uplift; CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`. FIN-08AA, WP-196 and WP-197 were not retried.

## QUAL-2026-08-07-12 — WP171 corrected Preview broker source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-12-wp171-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-12-wp171-source-attribution.json`
- Result: targeted `node:test` `12/12` passed, WP171 source-entry process coverage is lines `63.48%`, branches `88.71%`, functions `68.75%`; scoped ESLint and diff-check pass.
- Pure local contract only: `runParent`, staging, database, Browser and PayUni were not executed. Global coverage was not recomputed; last authoritative global remains `39.42/45.15/47.80/59.74` against unchanged `63/57/60/65`.
- No score uplift; CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`. FIN-08AA, WP-196 and WP-197 were not retried.

## QUAL-2026-08-07-13 — WP174 fresh Preview PayUni read-only source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-13-wp174-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-13-wp174-source-attribution.json`
- Result: targeted `node:test` `11/11` passed, WP174 source-entry process coverage is lines `73.11%`, branches `83.89%`, functions `80.00%`; scoped ESLint and diff-check pass.
- Pure logic only: `runLive`, staging, database, Browser and PayUni were not executed. Global coverage was not recomputed; last authoritative global remains `39.42/45.15/47.80/59.74` against unchanged `63/57/60/65`.
- No score uplift; CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`. FIN-08AA, WP-196 and WP-197 were not retried.

## QUAL-2026-08-07-14 — FIN-08R deterministic reconciliation source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-14-fin08r-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-14-fin08r-source-attribution.json`
- Result: targeted `node:test` `11/11` passed, FIN-08R source-entry process coverage is lines `51.65%`, branches `91.49%`, functions `64.00%`; scoped ESLint and diff-check pass.
- Pure logic only: execute-once, sterile coordinator, live child, staging, database and PayUni were not executed. Global coverage was not recomputed; last authoritative global remains `39.42/45.15/47.80/59.74` against unchanged `63/57/60/65`.
- No score uplift; CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`. FIN-08AA, WP-196 and WP-197 were not retried.

## QUAL-2026-08-07-15 — WP156 local server readiness source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-15-wp156-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-15-wp156-source-attribution.json`
- Result: targeted `node:test` `14/14` passed, WP156 source-entry process coverage is lines `75.22%`, branches `74.48%`, functions `90.00%`; scoped ESLint and diff-check pass.
- Local helper only: Next server, Browser, database, staging and PayUni were not executed. Global coverage was not recomputed; last authoritative global remains `39.42/45.15/47.80/59.74` against unchanged `63/57/60/65`.
- No score uplift; CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`. FIN-08AA, WP-196 and WP-197 were not retried.

## QUAL-2026-08-07-16 — FIN-08T deterministic reconciliation source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-16-fin08t-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-16-fin08t-source-attribution.json`
- Result: targeted `node:test` `9/9` passed, FIN-08T source-entry process coverage is lines `78.50%`, branches `83.00%`, functions `67.86%`; scoped ESLint and diff-check pass.
- Pure local logic only: execute-once, coordinator, live child, staging, database, Browser, Next server and PayUni were not executed. Global coverage was not recomputed; last authoritative global remains `39.42/45.15/47.80/59.74` against unchanged `63/57/60/65`.
- No score uplift; CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`. FIN-08AA, WP-196 and WP-197 were not retried.

## QUAL-2026-08-07-17 — FIN-08 legacy reconciliation source attribution and global coverage recomputation

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-17-fin08-global-coverage.md`
- Report: `.ai-team/reports/qual-2026-08-07-17-fin08-global-coverage.json`
- Result: targeted FIN-08 `node:test` `13/13` passed; source-entry process coverage is lines `61.79%`, branches `66.67%`, functions `64.29%`; scoped ESLint and diff-check pass.
- Global recomputation: Vitest `186 files / 1327 passed`, Node TAP `676/676 passed`, but global gate exits 1 at statements `40.57%`, branches `46.40%`, functions `49.07%`, lines `60.98%` against unchanged `63/57/60/65`.
- Local fake DB/provider stubs only; no staging, PayUni, Browser, Next server or Production execution. No score uplift; CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`. FIN-08AA, WP-196 and WP-197 were not retried.

## QUAL-2026-08-07-18 — FIN-08R reconciliation source attribution and global coverage recomputation

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-18-fin08r-global-coverage.md`
- Report: `.ai-team/reports/qual-2026-08-07-18-fin08r-global-coverage.json`
- Result: targeted FIN-08R `node:test` `14/14` passed; source-entry process coverage is lines `63.19%`, branches `66.20%`, functions `74.07%`; scoped ESLint and diff-check pass.
- Global recomputation: Vitest `186 files / 1327 passed`, Node TAP `679/679 passed`, but global gate exits 1 at statements `40.65%`, branches `46.46%`, functions `49.16%`, lines `61.08%` against unchanged `63/57/60/65`.
- Local fake DB/provider stubs only; no staging, PayUni, Browser, Next server or Production execution. No score uplift; CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`. FIN-08AA, FIN-08AB, WP-196 and WP-197 were not retried.

## FUNC-2026-08-07-19 — Public live direct-entry affiliate attribution closure

- Evidence: `docs/ai-team/evidence/func-2026-08-07-19-direct-entry-attribution-closure.md`
- Report: `.ai-team/reports/func-2026-08-07-19-direct-entry-attribution-closure.json`
- Result: new same-origin direct-entry cookie reset route, client wiring and 31/31 route registry/test inventory; targeted 62/62, full Vitest 187 files/1335 passed, Node contracts 679/679 passed, typecheck and architecture gate pass.
- Security: synthetic WP168/WP170 mismatch fixtures changed to loopback `127.0.0.1` and `*_test` names; 29/29 fixture tests pass and `npm run secret:scan` is `secret_scan_passed`.
- No staging, PayUni, Browser, Next server, DB or Production execution. No score uplift; CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`. FIN-08AA, FIN-08AB, WP-196 and WP-197 were not retried.

- Report: `.ai-team/reports/func-2026-08-07-20-checkout-idempotency-closure.json`
- Result: checkout requires UUID idempotency key; vendor-scoped unique identity, SERIALIZABLE duplicate resolution, persisted checkout replay and bounded in-progress/mismatch responses are implemented.
- Verification: targeted 4 files/55 passed, concurrent duplicate regression 1 transaction + 1 reservation, full Vitest 187 files/1340 passed, Node contracts 679/679 passed, typecheck, architecture/inventory gate, lint and secret scan pass; loopback disposable catalog confirms column/index.
- No staging, PayUni, Browser, Next server, Production or external payment execution. Coverage remains QUAL-18 `40.65/46.46/49.16/61.08` against `63/57/60/65`; no score uplift, CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5`.

- Report: `.ai-team/reports/sec-2026-08-07-03-dependency-audit.json`
- Result: fresh `npm audit --audit-level=high` reports 0 vulnerabilities across 737 dependencies; `js-yaml` is resolved at 4.3.1 with the existing minimal override active.
- No source, package, lockfile, threshold, exclude, skip or assertion change. Only npm registry audit metadata was queried; CAT04 `6.0`, CAT10 `4.5`, total `73.5` remain unchanged.

## QUAL-2026-08-07-19 — Current-source global coverage recomputation after FUNC-19/20 and SEC-03

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-19-global-coverage.md`
- Report: `.ai-team/reports/qual-2026-08-07-19-global-coverage.json`
- Result: Vitest `187 files / 1340 passed`, Node contracts `679/679 passed`; global coverage remains below the unchanged `63/57/60/65` gate at statements `40.73%`, branches `46.56%`, functions `49.25%`, lines `61.16%`, command exit `1`.
- This is the latest source-attribution quality result, not a score uplift. CAT04 `6.0`, CAT06 `7.0`, CAT10 `4.5`, total `73.5` remain unchanged. No staging, PayUni, Production or terminal external path was executed or retried.

## RELEASE-RECONCILIATION-2026-08-07-01 — Latest launch truth

- Evidence: `docs/ai-team/evidence/release-reconciliation-2026-08-07-01.md`
- Report: `.ai-team/reports/release-reconciliation-2026-08-07-01.json`
- `readiness-truth-reconciliation` passed with total `73.5`, category count `10`, `G1=CLOSED`, `SANDBOX_READY=false`, `PRODUCTION_READY=false`, and score change `0`.
- `release:verify:local` verified the local Next.js artifact only; environment availability was false for all required runtime/provider fields. CAT04/CAT10 acceptance gaps remain explicit and no score uplift was applied.

## ACCEPTANCE-PREP-2026-08-07-01 — CAT04/CAT10 authorized acceptance packet

- Evidence: `docs/ai-team/evidence/acceptance-prep-2026-08-07-01.md`
- Report: `.ai-team/reports/acceptance-prep-2026-08-07-01.json`
- Result: packet is `READY_FOR_AUTHORIZED_EXTERNAL_AND_MANUAL_ACCEPTANCE`, not PASS. CAT04 requires fresh staging/PayUni Sandbox/provider reconciliation; CAT10 requires five real owner decisions plus external monitoring evidence.
- No human signature, legal approval, provider receipt, staging mutation or score uplift was invented. Current CAT04 `6.0`, CAT10 `4.5`, total `73.5` remain unchanged.

## FUNC-2026-08-07-23 — Live runtime quota admission closure

- Evidence: `docs/ai-team/evidence/func-2026-08-07-23-live-runtime-quota-admission.md`
- Report: `.ai-team/reports/func-2026-08-07-23-live-runtime-quota-admission.json`
- Result: versioned live quota policy now has short-lived server admission for concurrent viewer limits and server-owned credits threshold; raw browser token is never persisted, same-live refresh is idempotent, and blocked admission covers public playback plus commerce overlay.
- Verification: 9 Vitest files／246 tests passed; `npm run typecheck`, scoped ESLint, `npm run secret:scan` pass; disposable loopback PostgreSQL validates/deploys/statuses 23/23 migrations and cleans container/temp root.
- Boundary: no staging, PayUni, Production, external payment, production data, secret read or terminal no-go retry. Canonical total remains `73.5` (CAT04 `6.0`, CAT10 `4.5`); runtime local closure does not create external/manual score evidence.


## FUNC-2026-08-07-24 — Platform plan checkout replay／stale callback closure

- Evidence: docs/ai-team/evidence/func-2026-08-07-24-platform-plan-checkout-stale-callback.md
- Report: .ai-team/reports/func-2026-08-07-24-platform-plan-checkout-stale-callback.json
- Result: deterministic vendor／plan checkout replay now reuses only a complete trusted pending transaction; older pending subscriptions are superseded and stale paid callbacks cannot activate them. Existing AffiliateCommission void action is extracted to a domain module while root compatibility remains.
- Verification: targeted 48/48; full Vitest 193 files / 1369 passed; Node contracts 679/679; architecture 4/4; typecheck, scoped ESLint, secret scan and diff check pass.
- Boundary: no staging, PayUni, Production, external payment, manual acceptance or terminal retry. Canonical total remains 73.5 (CAT04 6.0, CAT10 4.5); coverage gate remains open from QUAL-19 and was not recomputed in this WP.

## FUNC-2026-08-07-28 — Stream usage attribution allocation

- Evidence: `docs/ai-team/evidence/func-2026-08-07-28-stream-usage-attribution-allocation.md`
- Report: `.ai-team/reports/func-2026-08-07-28-stream-usage-attribution-allocation.json`
- Result: Live quota policy v2 now supports PROMOTER／OWNER／SPLIT／CUSTOM; stream heartbeat raw ledger and immutable internal allocation children are written atomically, with vendor/team/membership FK and recipient-key idempotency. Billing keeps provider aggregate separate from internal allocation totals.
- Verification: targeted domain 4 files／13 tests、full Vitest 199 files／1399 tests、Node contracts 679/679、Prisma validate/generate、typecheck、scoped ESLint、secret scan pass；disposable PostgreSQL 26/26 validate/deploy/status，allocation total reconciliation、duplicate rejection、cross-vendor recipient rejection與cleanup全 PASS。
- Boundary: local functional closure only. No staging, PayUni, Production, external payment, manual acceptance or terminal retry. Canonical total remains 73.5 (CAT01 7.5, CAT04 6.0, CAT10 4.5); coverage gate remains open from QUAL-19 and was not recomputed.

## FUNC-2026-08-07-29 — Live partner share link

- Evidence: `docs/ai-team/evidence/func-2026-08-07-29-partner-live-share.md`
- Report: `.ai-team/reports/func-2026-08-07-29-partner-live-share.json`, `.ai-team/reports/func-2026-08-07-29-partner-live-share-disposable.json`
- Result: B 可取得 A-owned Live 的 target-bound share link；server 以 token hash 驗證 active direct-downline、Live／page／team tenant binding，click、lead 與 stream usage 共用 A/B attribution snapshot；撤銷、過期、跨 tenant 與無效 token 均 fail closed。
- Verification: WP29 disposable PostgreSQL migration 27/27 contract pass；targeted 6 files／66 tests、registry/domain 3 files／12 tests、full Vitest 201 files／1413 tests、Node contracts 679/679、typecheck、Prisma validate/generate、secret scan、full lint 與 diff-check pass；lint 僅有既有 2 warnings。
- Boundary: local functional evidence only；raw share code 未保存，沒有 staging／PayUni／Production／正式付款退款／人工 owner acceptance，也未重試 FIN-08AA、WP-196、WP-197。canonical total 維持 73.5（CAT01 7.5、CAT04 6.0、CAT10 4.5），current score change `0`。

## QUAL-2026-08-07-25 — CAT10 onboarding and owner acceptance source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-25-cat10-operational-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-25-cat10-operational-source-attribution.json`
- Result: added isolated deterministic coverage for WP122 merchant onboarding and WP195 five-owner acceptance contracts, including human-pending, evidence, signature, production-claim and receipt score boundaries; production runners and receipt writers were not executed.
- Verification: targeted 1 file／8 tests、full Vitest 206 files／1459 tests、Node contracts 679/679、combined targeted source 78.37／79.66／82.60／84.43 statements／branches／functions／lines；typecheck、scoped lint、secret scan、diff-check pass。
- Global: recomputed `npm run test:coverage` exit `1`; combined coverage is `41.91／47.37／50.51／61.07` against unchanged `63／57／60／65`, `FAIL_REMAINING_SOURCE_INVENTORY`. CAT10 remains 4.5 because local evidence cannot replace human owners or external monitoring; canonical total remains 73.5. No staging, PayUni, Production or terminal retry.

## QUAL-2026-08-07-24 — WP175 source attribution and global coverage recomputation

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-24-wp175-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-24-wp175-source-attribution.json`
- Result: added an isolated non-excluded WP175 source-attribution suite for contract, protected source digest, bounded decisions and receipt sanitizer; production runner source was not modified and its writer was not executed.
- Verification: targeted 1 file／6 tests、full Vitest 205 files／1451 tests、Node contracts 679/679、WP175 source 86.51／86.36／93.33／85.29 statements／branches／functions／lines；typecheck、scoped lint、secret scan、diff-check pass。
- Global: recomputed `npm run test:coverage` exit `1`; combined coverage is `41.44／46.96／50.23／61.07` against unchanged `63／57／60／65`, `FAIL_REMAINING_SOURCE_INVENTORY`. Canonical total remains 73.5 (CAT04 6.0, CAT10 4.5), current goal score change `0`. No staging, PayUni, Production or terminal retry.

## QUAL-2026-08-07-23 — Stream usage attribution source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-23-stream-usage-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-23-stream-usage-attribution.json`
- Result: added deterministic source attribution for stream usage allocation defensive merge／invalid persisted total and concurrent unique-insert idempotency／payload-drift boundaries; production source was not modified.
- Verification: targeted 2 files／15 tests、full Vitest 204 files／1445 tests、stream-usage-attribution source 100／96.42／100／100 and stream-usage source 96.07／95／100／100 statements／branches／functions／lines；typecheck、scoped lint、secret scan、diff-check and readiness truth pass。
- Boundary: QUAL-19 remains the latest authoritative global coverage result `40.73／46.56／49.25／61.16` against `63／57／60／65`; canonical total remains 73.5 (CAT04 6.0, CAT10 4.5), current goal score change `0`. No staging, PayUni, Production or terminal retry.

## QUAL-2026-08-07-22 — Live funnel attribution source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-22-live-funnel-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-22-live-funnel-attribution.json`
- Result: added an isolated deterministic source-attribution suite for request parsing, cookie TTL, referral fallback, Live-share delegation and click／lead persistence without changing existing dirty attribution tests.
- Verification: targeted 2 files／21 tests、full Vitest 204 files／1441 tests、attribution source statements 92.80%／branches 87.39%／functions 100%／lines 96.11%，typecheck、scoped lint、secret scan、diff-check pass。
- Boundary: QUAL-19 remains the latest authoritative global coverage result `40.73／46.56／49.25／61.16` against `63／57／60／65`; canonical total remains 73.5 (CAT04 6.0, CAT10 4.5). No staging, PayUni, Production or terminal retry.

## QUAL-2026-08-07-21 — Live share domain source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-21-live-share-domain-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-21-live-share-domain-attribution.json`
- Result: the WP29 Live partner share domain now has deterministic coverage for token, ownership, lifecycle, relationship, expiry and revocation fail-closed boundaries.
- Verification: targeted 1 file／13 tests、combined targeted 3 files／24 tests、full Vitest 203 files／1432 tests、domain source statements 100%／branches 95.12%／functions 100%／lines 100%，typecheck、scoped lint、secret scan、diff-check pass。
- Boundary: QUAL-19 remains the latest authoritative global coverage result `40.73／46.56／49.25／61.16` against `63／57／60／65`; canonical total remains 73.5 (CAT04 6.0, CAT10 4.5). No staging, PayUni, Production or terminal retry.

## QUAL-2026-08-07-20 — Live share action／UI source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-20-live-share-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-20-live-share-source-attribution.json`
- Result: targeted deterministic tests cover the new Live share server action and merchant UI boundaries without changing the global gate.
- Verification: targeted 2 files／11 tests、full Vitest 203 files／1424 tests、action source statements 100%／branches 92.30%／functions 100%／lines 100%，typecheck、scoped lint、secret scan、diff-check pass。
- Boundary: last authoritative global coverage remains QUAL-19 `40.73／46.56／49.25／61.16` against `63／57／60／65`; canonical total remains 73.5 (CAT04 6.0, CAT10 4.5). No staging, PayUni, Production or terminal retry.

## FUNC-2026-08-07-30 — Live partner share merchant UI

- Evidence: `docs/ai-team/evidence/func-2026-08-07-30-live-share-ui.md`
- Report: `.ai-team/reports/func-2026-08-07-30-live-share-ui.json`
- Result: `/partner-pages` now exposes create／renew／revoke controls for A-owned Live pages and direct-downline targets; share URL is one-time action state only, with server-side auth／CSRF／audit and no raw token in initial render or persistence.
- Verification: targeted 4 files／17 tests、full Vitest 203 files／1417 tests、Node contracts 679/679、typecheck、Prisma validate/generate、secret scan、full lint（0 error／既有2 warnings）與 diff-check pass。
- Boundary: local product closure only. No staging, PayUni, Production, external payment, manual acceptance or terminal retry. Canonical total remains 73.5 (CAT04 6.0, CAT10 4.5); coverage gate remains open from QUAL-19 and was not recomputed.

## FUNC-2026-08-07-27 — Live resource tenant binding

- Evidence: `docs/ai-team/evidence/func-2026-08-07-27-live-resource-tenant-binding.md`
- Report: `.ai-team/reports/func-2026-08-07-27-live-resource-tenant-binding.json`
- Result: Live `videoId`／`formId` now require vendor-scoped composite database binding; preflight rejects legacy missing or cross-vendor rows, while nullable delete semantics retain `SET NULL`.
- Verification: targeted 2 files／4 tests、full Vitest 197 files／1388 tests、Node contracts 679/679、Prisma validate/generate、typecheck、scoped ESLint、secret scan pass；disposable PostgreSQL 25/25 validate/deploy/status，valid/cross-vendor/delete regression與cleanup全 PASS。
- Boundary: this is local DB-integrity closure only. No staging, PayUni, Production, external payment, manual acceptance or terminal retry. Canonical total remains 73.5 (CAT04 6.0, CAT10 4.5); coverage gate remains open from QUAL-19 and was not recomputed.

## FUNC-2026-08-07-26 — Stream usage admission／LiveProduct tenant binding

- Evidence: `docs/ai-team/evidence/func-2026-08-07-26-stream-usage-admission-live-product-tenant.md`
- Report: `.ai-team/reports/func-2026-08-07-26-stream-usage-admission-live-product-tenant.json`
- Result: stream usage ledger now requires an active exact vendor/live admission session before recording heartbeat usage; LiveProduct now has vendor-scoped composite relations with fail-closed legacy backfill preflight.
- Verification: targeted 7 files／35 tests passed; Prisma validate/generate、typecheck、scoped ESLint pass；disposable PostgreSQL 24/24 validate/deploy/status，valid insert、cross-vendor live rejection、cross-vendor product rejection 與 container/temp cleanup 全 PASS。
- Boundary: this is local functional／tenant-integrity closure only. No staging, PayUni, Production, external payment, manual acceptance or terminal retry. Canonical total remains 73.5 (CAT04 6.0, CAT10 4.5); coverage gate remains open from QUAL-19 and was not recomputed.

## FUNC-2026-08-07-25 — Live admission server playback source boundary

- Evidence: docs/ai-team/evidence/func-2026-08-07-25-live-playback-source-boundary.md
- Report: .ai-team/reports/func-2026-08-07-25-live-playback-source-boundary.json
- Result: public live SSR no longer queries or passes `videoUrl`; an admitted, unexpired vendor/live-bound session is required before `GET /api/live-playback-source` returns the source. Blocked, expired and cross-tenant cases fail closed without source disclosure.
- Verification: targeted route/page/domain contract 15/15; full Vitest 195 files / 1378 passed; Node contracts 679/679; typecheck, scoped ESLint, secret scan and API registry 33/33 pass.
- Boundary: no staging, PayUni, Production, external payment, manual acceptance or terminal retry. Canonical total remains 73.5 (CAT04 6.0, CAT10 4.5); coverage gate remains open from QUAL-19 and was not recomputed in this WP.

## QUAL-2026-08-07-26 — Settlement page source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-26-settlement-page-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-26-settlement-page-source-attribution.json`
- Result: finance admin／merchant settlement read models now have deterministic attribution across settlement states, lock／payout actions, adjustment fields, batch details and empty-state boundaries; production source unchanged.
- Verification: isolated 2 files／4 tests、full Vitest 208 files／1463 tests、Node contracts 679/679、settlement page source attribution 100／97.05／100／100 and 100／100／100／100、typecheck、lint 0 errors、secret scan、diff-check pass；combined global coverage 41.96／47.53／50.64／61.13 對 63／57／60／65，exit 1、FAIL_REMAINING_SOURCE_INVENTORY。
- Boundary: local deterministic QUAL evidence only. CAT04 remains 6.0 and still requires fresh staging／PayUni provider evidence; CAT10 remains 4.5 and still requires human／external owner evidence. Canonical total remains 73.5; no terminal external path retried.

## QUAL-2026-08-07-27 — Billing plans checkout source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-27-billing-plans-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-27-billing-plans-source-attribution.json`
- Result: billing plans／subscription checkout page now has deterministic attribution for owner／non-owner access, pending transaction binding, allowlisted form／redirect checkout, metadata sanitization and unsafe fallback; production source unchanged.
- Verification: isolated 1 file／3 tests、full Vitest 209 files／1466 tests、Node contracts 679/679、page source statements／branches／functions／lines 93.10／92.64／100／96.42、typecheck、lint 0 errors、secret scan、diff-check pass；combined global coverage 42.00／47.68／50.74／61.19 對 63／57／60／65，exit 1、FAIL_REMAINING_SOURCE_INVENTORY。
- Boundary: local deterministic QUAL evidence only. CAT04 remains 6.0 and still requires fresh staging／PayUni provider evidence; CAT10 remains 4.5 and still requires human／external owner evidence. Canonical total remains 73.5; no payment、staging、PayUni or terminal external path executed.

## QUAL-2026-08-07-28 — Finance payout page source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-28-finance-payout-page-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-28-finance-payout-page-source-attribution.json`
- Result: course payout 與 platform referral payout admin page now have deterministic attribution for pending／paid／void／batched states、recipient identity、batch creation、status-specific outcomes、safe error 與 empty state；production source unchanged。
- Verification: isolated 2 files／4 tests、full Vitest 211 files／1470 tests、Node contracts 679/679、兩個 page source statements／branches／functions／lines 100／100／100／100、typecheck、lint 0 errors／既有2 warnings、secret scan、diff-check pass；combined global coverage 42.10／47.81／50.94／61.31 對 63／57／60／65，exit 1、FAIL_REMAINING_SOURCE_INVENTORY。
- Boundary: local deterministic finance evidence only。CAT04 remains 6.0 and still requires fresh staging／PayUni provider evidence；CAT10 remains 4.5 and still requires human／external owner evidence。Canonical total remains 73.5；no bank transfer、KYC／tax、payment、staging、PayUni or terminal external path executed。

## FIN-2026-08-07-29 — Platform referral dispute／chargeback closure

- Evidence: `docs/ai-team/evidence/fin-2026-08-07-29-platform-referral-dispute-closure.md`
- Report: `.ai-team/reports/fin-2026-08-07-29-platform-referral-dispute-closure.json`
- Result: platform referral commission ledger now closes dispute opened／released／lost lifecycle with persisted dispute case identity, one-time current-balance reversal, terminal replay idempotency and commission void after lost；payment webhook now reconciles referral-only dispute events。
- Verification: targeted domain 7/7、payment webhook 40/40、full Vitest 211 files／1473 tests、Node contracts 679/679、disposable PostgreSQL 28/28 migrations、Prisma validate／generate、typecheck、lint 0 errors／既有2 warnings、secret scan、diff-check PASS。
- Coverage: global `npm run test:coverage` truthfully remains exit 1 at 42.15／47.87／50.99／61.34 against 63／57／60／65；feature tests were not blocked and no threshold／inventory reduction／exclude／skip／assertion weakening occurred。
- Boundary: canonical total remains 73.5 (CAT04 6.0、CAT10 4.5、current goal score change 0)。No staging、PayUni、Production、payment、refund、bank transfer、manual owner acceptance or terminal no-go retry。Goal remains IN_PROGRESS。

## FUNC-2026-08-07-31 — Live share → lead → checkout attribution closure

- Evidence: `docs/ai-team/evidence/func-2026-08-07-31-live-share-checkout-attribution.md`
- Report: `.ai-team/reports/func-2026-08-07-31-live-share-checkout-attribution.json`
- Result: 修正 verified Live share click 未設定 sticky attribution cookie 的 P1 bug；B 的 server-owned promoter identity 現在能從 shared Live click 延續到後續 checkout，沒有 affiliate identity 的 shared page 仍 fail closed。
- Verification: targeted 6 files／69 tests、disposable full Vitest 211 files／1474 tests、Node contracts 679/679、disposable PostgreSQL 28/28 deploy＋status up to date、typecheck、full lint 0 errors／既有2 warnings、secret scan、scoped diff-check PASS。
- Boundary: 本機 dev DB full run 的 2 個 FIN-29 schema mismatch failures 未被當作 evidence；未修改本機 DB。Canonical total remains 73.5 (CAT04 6.0、CAT10 4.5、current goal score change 0)。No staging、PayUni、Production or terminal no-go retry。Goal remains IN_PROGRESS。

## FUNC-2026-08-07-32 — Live share commercial flow cross-route evidence

- Evidence: `docs/ai-team/evidence/func-2026-08-07-32-live-share-commercial-flow.md`
- Report: `.ai-team/reports/func-2026-08-07-32-live-share-commercial-flow.json`
- Result: 新增 deterministic route-composition test，驗證同一個 verified Live share promoter lineage 由 click cookie 經 lead attribution 延續到 checkout transaction metadata；provider／DB／inventory 均為 synthetic boundary。
- Verification: new flow 1/1、相關 regression 7 files／70 tests、disposable full Vitest 212 files／1475 tests、Node contracts 679/679、28/28 migrations up to date、typecheck、full lint 0 errors／既有2 warnings、secret scan、diff-check pass；第一次 unsafe DB name 被 local safety guard 前置拒絕，沒有啟動 Vitest 且已清理，後續 allowlisted disposable DB run PASS。
- Boundary: canonical total remains 73.5 (CAT04 6.0、CAT10 4.5、current goal score change 0)。CAT04 仍缺 fresh authorized staging／PayUni provider receipt；CAT10 仍缺真人 owner／external monitoring evidence。No staging、PayUni、Production、external payment、manual acceptance or terminal no-go retry。

## QUAL-2026-08-07-29 — Affiliate commission void action source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-29-affiliate-action-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-07-29-affiliate-action-source-attribution.json`
- Result: 為 finance-admin commission void／ledger reversal／audit action 補 deterministic source attribution；target source `src/app/actions/affiliate-actions.ts` coverage 為 statements 96.15／branches 82.35／functions 100／lines 100。
- Verification: targeted 1 file／5 tests、disposable finance regression 6 files／225 tests、global coverage Vitest 213 files／1480 tests、Node contracts 679/679、28/28 disposable migrations、typecheck、lint 0 errors／既有2 warnings、secret scan、diff-check PASS；global coverage `42.22／47.95／51.05／61.47` 對 `63／57／60／65`，exit 1、`FAIL_REMAINING_SOURCE_INVENTORY`。
- Boundary: canonical total remains 73.5 (CAT04 6.0、CAT10 4.5、current goal score change 0)。本機 dev schema mismatch 的 2 failures 未當 evidence；未執行 staging、PayUni、Production、付款／退款或 terminal no-go retry。

## FUNC-2026-08-07-33 — Partner Page 儲存／發布閉環

- Evidence: `docs/ai-team/evidence/func-2026-08-07-33-partner-page-save-publish-closure.md`
- Report: `.ai-team/reports/func-2026-08-07-33-partner-page-save-publish-closure.json`
- Result: Partner Page save／publish action 補齊 ownership、CTA URL、field lock、四個 product slot delegation 與 PUBLIC／DISABLED share setting 的 deterministic coverage；production path 未新增修改。
- Verification: targeted action 7/7、combined partner regression 6 files／49 tests、disposable full Vitest 213 files／1485 tests、Node contracts 679/679、disposable PostgreSQL 28/28 migrations up to date、typecheck、full lint 0 errors／既有2 warnings、secret scan、diff-check PASS；target source 87.36／81.03／85.71／95.06。
- Coverage: global `42.29／48.00／51.09／61.56` 對 `63／57／60／65`，exit 1、`FAIL_REMAINING_SOURCE_INVENTORY`；coverage gate 未阻擋功能測試，未降低 threshold／inventory／exclude／skip／assertion。
- Boundary: canonical total remains 73.5 (CAT04 6.0、CAT10 4.5、current goal score change 0)。CAT04 仍缺 fresh authorized staging／PayUni provider receipt；CAT10 仍缺真人 owner／external monitoring evidence。No staging、PayUni、Production、正式付款／退款、deployment、push、merge or terminal no-go retry。

## FIN-2026-08-07-30 — PayUni 退款終態對帳頁閉環

- Evidence: `docs/ai-team/evidence/fin-2026-08-07-30-payuni-refund-reconciliation-page-closure.md`
- Report: `.ai-team/reports/fin-2026-08-07-30-payuni-refund-reconciliation-page-closure.json`
- Result: 修正成功 reconciliation 的 Next.js redirect 被 try/catch 誤捕而導向 error 的 finance P1；非 PayUni provider 現在在 UI 直接 fail closed，不顯示 Sandbox action。
- Verification: page 8/8、finance targeted 6 files／97 tests、corrected disposable full Vitest 213 files／1490 tests、Node contracts 679/679、28/28 disposable migrations、typecheck、full lint 0 errors／既有2 warnings、secret scan、diff-check PASS；target page 94.44／87.80／100／94.11。
- Coverage: global `42.36／48.07／51.11／61.68` 對 `63／57／60／65`，exit 1、`FAIL_REMAINING_SOURCE_INVENTORY`；coverage gate 未阻擋功能測試，未降低 threshold／inventory／exclude／skip／assertion。
- Boundary: canonical total remains 73.5 (CAT04 6.0、CAT10 4.5、current goal score change 0)。local dev targeted 2 schema-mismatch failures 未當 evidence；CAT04 仍缺 fresh staging／PayUni provider receipt，CAT10 仍缺真人 owner／external monitoring evidence。No Production、正式DB、正式付款／退款、deployment、push、merge or terminal no-go retry。

## FUNC-2026-08-07-34 — Platform referral failed-checkout retry closure

- Evidence: `docs/ai-team/evidence/func-2026-08-07-34-platform-referral-failed-checkout-retry-closure.md`
- Report: `.ai-team/reports/func-2026-08-07-34-platform-referral-failed-checkout-retry-closure.json`
- Result: 修正平台方案 checkout setup failure 與 provider `failed` webhook 遺留 referral attribution snapshot 的 P1；只有尚未付款的 `pending_payment` snapshot 會釋放，成功付款後的 attribution history 保留。
- Verification: billing plan action 10/10、failed webhook target 1/1、disposable PostgreSQL 28/28 migrations／四個相關 suite 61/61、typecheck、scoped ESLint、diff-check PASS；本機 full webhook run 的 schema mismatch／初始 fixture cleanup failures 未當 evidence。
- Boundary: global coverage 未在本 WP 重跑，最近 authoritative gate 仍為 42.36／48.07／51.11／61.68 對 63／57／60／65、`FAIL_REMAINING_SOURCE_INVENTORY`；canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。No staging、PayUni、Production、正式付款／退款、deployment、push、merge or terminal no-go retry。

## FUNC-2026-08-07-35 — Platform referral direct-entry／readonly UI closure

- Evidence: `docs/ai-team/evidence/func-2026-08-07-35-platform-referral-direct-entry-ui-closure.md`
- Report: `.ai-team/reports/func-2026-08-07-35-platform-referral-direct-entry-ui-closure.json`
- Result: 方案推薦官方入口、direct-entry reset、方案頁唯讀推薦人 ID／名稱／狀態、checkout hidden context 與 server validation 已接成同一條流程；直接進入方案網址不再繼承舊 platform referral cookie。
- Verification: focused route/page/action 6 files／53 tests、reset component 2/2、disposable PostgreSQL 28/28 migrations／7 files 70/70、typecheck、scoped ESLint、diff-check PASS。
- Boundary: global coverage 未在本 WP 重跑，最近 authoritative gate 仍為 42.36／48.07／51.11／61.68 對 63／57／60／65、`FAIL_REMAINING_SOURCE_INVENTORY`；canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。No staging、PayUni、Production、正式付款／退款、deployment、push、merge or terminal no-go retry。

## FUNC-2026-08-07-36 — External partner product click attribution closure

- Evidence: `docs/ai-team/evidence/func-2026-08-07-36-external-product-click-attribution.md`
- Report: `.ai-team/reports/func-2026-08-07-36-external-product-click-attribution.json`
- Result: 夥伴公開頁外部商品連結現在先記錄帶 vendor／live／source page／slot／推薦碼的 server-validated click attribution，再離站；tracking 失敗仍放行導流，且 UI 明確說明外部付款／退款／佣金不由 CelebrateDeal 宣稱。
- Verification: focused 4 files／35 tests、既有 affiliate-click API regression、typecheck、scoped ESLint、diff-check PASS；無 schema／migration 變更。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。Global coverage 沿用 42.36／48.07／51.11／61.68 對 63／57／60／65 的 `FAIL_REMAINING_SOURCE_INVENTORY`；沒有 staging、PayUni、Production、外部付款、人工簽核或 terminal no-go retry。

## FUNC-2026-08-07-37 — Course gross／net reference payout closure

- Evidence: `docs/ai-team/evidence/func-2026-08-07-37-course-gross-net-reference.md`
- Report: `.ai-team/reports/func-2026-08-07-37-course-gross-net-reference.json`
- Result: 課程 payout 現在分開保存／顯示按售價的 gross sales base、退款／費用調整後的 provider-net reference 與實際 F/G payable；F/G 同一付款的 allocation rows 依 payment transaction 去重，legacy 未有 snapshot 的 payout 顯示未知而非虛構 0。
- Verification: focused 4 files／10 tests、10 passed；Prisma generate、loopback disposable migration、typecheck、scoped ESLint、diff-check PASS。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。Global coverage 沿用 42.36／48.07／51.11／61.68 對 63／57／60／65 的 `FAIL_REMAINING_SOURCE_INVENTORY`；migration 僅作用於 `127.0.0.1:54329/celebratedeal_test`，沒有 staging、PayUni、Production、外部付款、人工簽核或 terminal no-go retry。

## FIN-2026-08-07-38 — Platform referral initial-only commission closure

- Evidence: `docs/ai-team/evidence/fin-2026-08-07-38-platform-referral-initial-only.md`
- Report: `.ai-team/reports/fin-2026-08-07-38-platform-referral-initial-only.json`
- Result: 同一新訂閱只在首次成功付款產生平台推薦佣金；續費不重複計算，退款／拒付／dispute 仍走既有 ledger lifecycle，並以 subscription unique constraint 保護競態條件。
- Verification: focused 2 files／12 tests、renewal webhook 2/2、broader finance regression 5 files／65 tests 全 PASS；Prisma validate／generate、typecheck、scoped ESLint、diff-check PASS。回歸測試另發現並以 additive nullable migration 修正 AffiliatePayout gross/net schema drift。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。Global coverage 仍為 42.36／48.07／51.11／61.68 對 63／57／60／65 的 `FAIL_REMAINING_SOURCE_INVENTORY`；兩個 migration 僅作用於 `127.0.0.1:54329/celebratedeal_test`，沒有 staging、PayUni、Production、外部付款、人工簽核或 terminal no-go retry。

## FUNC-2026-08-07-39 — Stream usage truth reconciliation

- Evidence: `docs/ai-team/evidence/func-2026-08-07-39-stream-usage-truth.md`
- Report: `.ai-team/reports/func-2026-08-07-39-stream-usage-truth.json`
- Result: billing usage 頁面現在讀取本月 immutable `StreamUsageLedgerEntry`，並與 legacy usage aggregate／counter 對齊；settlement 與 usage page 共用分鐘換算，stale counter 不會低報 ledger 用量。
- Verification: focused 2 files／24 tests、playback／quota／billing regression 6 files／60 tests 全 PASS；typecheck、scoped ESLint、diff-check PASS；沒有 schema／migration、staging、PayUni 或 Production 操作。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。Global coverage 仍為 42.36／48.07／51.11／61.68 對 63／57／60／65 的 `FAIL_REMAINING_SOURCE_INVENTORY`；quota exhaustion、auto-charge、通知、grace 與停用政策仍未宣稱完成。

## FUNC-2026-08-07-40 — Stream included-minute quota enforcement

- Evidence: `docs/ai-team/evidence/func-2026-08-07-40-stream-quota-enforcement.md`
- Report: `.ai-team/reports/func-2026-08-07-40-stream-quota-enforcement.json`
- Result: Live admission 與 heartbeat ledger create 前現在會以 immutable 當月 ledger 秒數及 reset-aware legacy counter enforce 包含分鐘數邊界；exact boundary allowed，跨界 fail closed，API 回安全 429 no-store。
- Verification: focused quota／usage 4 files／31 tests、related playback／quota regression 9 files／55 tests 全 PASS；typecheck、scoped ESLint、diff-check PASS；沒有 schema／migration、staging、PayUni 或 Production 操作。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。Global coverage 仍為 42.36／48.07／51.11／61.68 對 63／57／60／65 的 `FAIL_REMAINING_SOURCE_INVENTORY`；auto-charge、付款方式驗證、通知、retry、grace 與停用政策仍未宣稱完成。

## FUNC-2026-08-07-41 — Billing quota policy UI truth

- Evidence: `docs/ai-team/evidence/func-2026-08-07-41-billing-quota-policy-ui.md`
- Report: `.ai-team/reports/func-2026-08-07-41-billing-quota-policy-ui.json`
- Result: 方案頁現在明確說明 Stream 額度用完會暫停新播放且沒有自動超額扣款；用量頁顯示 explicit overage／未設定上限，不再顯示負剩餘，並補上儲存超額參考單價。
- Verification: billing quota UI regression 7 files／54 tests 全 PASS；typecheck、scoped ESLint、diff-check PASS；沒有 schema／migration、staging、PayUni 或 Production 操作。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。WP40／WP41 後尚未重跑 current-tree global coverage；source changes 前最新已記錄值 42.36／48.07／51.11／61.68 對 63／57／60／65 的 `FAIL_REMAINING_SOURCE_INVENTORY` 只作歷史 baseline，不冒充最新 gate。付款方式驗證、auto-charge、通知、retry、grace 與停用政策仍未宣稱完成。

## QUAL-2026-08-07-30 — Current-tree coverage contract reconciliation

- Evidence: `docs/ai-team/evidence/qual-2026-08-07-30-current-tree-coverage-reconciliation.md`
- Report: `.ai-team/reports/qual-2026-08-07-30-current-tree-coverage-reconciliation.json`
- Result: 修正 current-tree coverage 暴露的 billing source signal、Prisma inventory、AffiliatePayout compatibility contract 與 type-safety runner timeout；沒有改變 assertion、threshold、exclude 或 skip。
- Verification: targeted contract 6 files／23 tests PASS；full Vitest 216 files／1511 tests PASS；Node contract 679 PASS；typecheck、scoped ESLint、diff-check PASS。
- Boundary: global coverage 實際為 42.53／48.19／51.34／61.86 對 63／57／60／65，exit 1 `FAIL_REMAINING_SOURCE_INVENTORY`；canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。本輪為品質 contract reconciliation，下一步回到 Stream per-member／per-page quota policy 等產品功能。

## FUNC-2026-08-07-42 — Stream member／page attribution usage breakdown

- Evidence: `docs/ai-team/evidence/func-2026-08-07-42-stream-attribution-usage-breakdown.md`
- Report: `.ai-team/reports/func-2026-08-07-42-stream-attribution-usage-breakdown.json`
- Result: billing usage page 現在顯示本月 immutable Stream allocation 的成員歸屬、推廣頁歸屬與直接播放，並保留 vendor aggregate quota 的真實說法。
- Verification: 1 file／9 tests PASS；typecheck、scoped ESLint、diff-check PASS；無 schema／migration、staging、PayUni 或 Production 操作。
- Boundary: per-member independent quota、payment method、auto-charge、通知／retry／grace／停用仍未完成；canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。Global coverage 沿用 42.53／48.19／51.34／61.86 對 63／57／60／65 的 `FAIL_REMAINING_SOURCE_INVENTORY`。

## FUNC-2026-08-07-43 — Per-member／per-page Stream quota enforcement

- Evidence: `docs/ai-team/evidence/func-2026-08-07-43-scoped-stream-quota-enforcement.md`
- Report: `.ai-team/reports/func-2026-08-07-43-scoped-stream-quota-enforcement.json`
- Result: 直播規則可設定成員／推廣頁分鐘上限；immutable usage ledger 寫入前依同一 live／月份的 allocation 或 page usage fail closed，Serializable conflict 也不放行；billing usage 顯示 80%／100% in-app notification。
- Verification: quota／billing／admission／action／component regression 11 files／227 tests PASS；typecheck、scoped ESLint、diff-check PASS；無 schema／migration、staging、PayUni 或 Production 操作。
- Boundary: external email／push、payment method、auto-charge、retry／grace／disable 仍未完成；canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。Global coverage 尚未重跑，沿用 42.53／48.19／51.34／61.86 對 63／57／60／65 的前一輪 `FAIL_REMAINING_SOURCE_INVENTORY` baseline，不冒充 current-tree 結果。

## FUNC-2026-08-07-44 — Payment method reference safe contract

- Evidence: `docs/ai-team/evidence/func-2026-08-07-44-payment-method-reference-contract.md`
- Report: `.ai-team/reports/func-2026-08-07-44-payment-method-reference-contract.json`
- Result: 新增獨立的 opaque payment method reference model 與 additive migration；Stream 額度可指定 VENDOR 或 MEMBER 付款人，只有已驗證且未過期的 provider reference 才能啟用，缺少 reference 時 action fail closed。PaymentAccount 仍只代表商家 payout／configuration account，沒有被當成顧客 charging method。
- Verification: payment reference／quota policy／live action／stepper regression 5 files／175 tests PASS；post-refactor action／payment rerun 2 files／159 tests PASS；Prisma validate、Prisma generate、typecheck、scoped ESLint、diff-check PASS；32/32 disposable PostgreSQL migrations PASS，container／tempRoot cleanup PASS。
- Boundary: provider setup adapter 目前只定義安全的 optional contract，PayUni recurring setup／auto-charge、staging／Sandbox receipt、外部付款與真人簽核仍未完成；canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。current-tree global coverage 尚未在本 WP 重跑，不沿用舊 baseline 冒充最新 gate。

## FUNC-2026-08-07-45 — Merchant payment method setup flow

- Evidence: `docs/ai-team/evidence/func-2026-08-07-45-payment-method-setup-flow.md`
- Report: `.ai-team/reports/func-2026-08-07-45-payment-method-setup-flow.json`
- Result: 商家後台新增付款方式設定頁與 Server Action；財務角色可分別發起商店／成員 setup，server 重新驗證 vendor membership ownership，頁面不呈現 opaque provider reference，unsafe redirect、form-post、manual 與 provider error 都安全回報。
- Verification: targeted 4 files／17 tests PASS；typecheck、scoped ESLint、diff-check PASS；無 schema／migration、staging、PayUni、Production 或外部付款操作。
- Boundary: PayUni setup／recurring auto-charge 尚未實作，canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。CAT04 仍需 authorized staging／PayUni Sandbox evidence；CAT10 仍需真人 owner、法律／客服／財務／release 與外部 monitoring evidence；global coverage 本 WP 未重跑。

## FUNC-2026-08-07-46 — Verified payment method callback boundary

- Evidence: `docs/ai-team/evidence/func-2026-08-07-46-payment-method-verified-callback.md`
- Report: `.ai-team/reports/func-2026-08-07-46-payment-method-verified-callback.json`
- Result: 新增 signed setup callback → sanitized WebhookEvent → Serializable verified opaque reference upsert 的本地產品閉環；vendor／active membership ownership revalidation、replay idempotency、cross-scope conflict 與 runtime scope validation 均 fail closed，raw provider payload／payment reference 不進 event payload。
- Verification: targeted 8 files／82 tests，82 passed；typecheck、scoped ESLint、diff-check PASS；無 schema／migration、staging、PayUni、Production 或外部付款操作。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。PayUni official setup adapter／Sandbox receipt 與 CAT10 真人／外部 evidence 仍 pending；global coverage 本 WP 未重跑。

## FUNC-2026-08-07-47 — Payment onboarding capability and event collision closure

- Evidence: `docs/ai-team/evidence/func-2026-08-07-47-payment-onboarding-capability.md`
- Report: `.ai-team/reports/func-2026-08-07-47-payment-onboarding-capability.json`
- Result: setup session、signed callback verification、verified-only normalization 三項能力現在必須一致存在；provider 不完整時商家頁不顯示可點擊 setup action。Webhook 同 provider／event ID 若撞到不同 event type 會回 409 `event_id_collision`，不誤判 duplicate；Dashboard onboarding 新增有效付款方式提醒，只把 verified 且未過期 reference 算完成。
- Verification: targeted 10 files／73 tests，73 passed；typecheck、scoped ESLint、diff-check PASS；無 schema／migration、staging、PayUni、Production 或外部付款操作。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。PayUni setup adapter／Sandbox receipt、recurring／overage orchestration 與 CAT10 真人／外部 evidence 仍 pending；global coverage 本 WP 未重跑。

## FUNC-2026-08-08-48 — Dashboard merchant onboarding route

- Evidence: `docs/ai-team/evidence/func-2026-08-08-48-dashboard-merchant-onboarding-route.md`
- Report: `.ai-team/reports/func-2026-08-08-48-dashboard-merchant-onboarding-route.json`
- Result: Dashboard onboarding checklist 現在導向 `/billing/payment-methods` 與 `/merchant-onboarding`；付款方式只有 verified 且未過期 reference 才算完成，商家 onboarding 保持未完成狀態並連到客服／政策 owner handoff，沒有把草稿或 AI 判斷當成真人 acceptance。
- Verification: targeted 2 files／13 tests，13 passed；typecheck、scoped ESLint、diff-check PASS。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。CAT10 真人／外部 acceptance、PayUni setup／Sandbox receipt 與 recurring／overage orchestration 仍 pending；global coverage 本 WP 未重跑。

## FUNC-2026-08-08-49 — Payment method revocation lifecycle

- Evidence: `docs/ai-team/evidence/func-2026-08-08-49-payment-method-revocation-lifecycle.md`
- Report: `.ai-team/reports/func-2026-08-08-49-payment-method-revocation-lifecycle.json`
- Result: 付款方式 reference 現在可由財務角色 tenant-scoped、idempotently 撤銷；local status 先切為 revoked 以確保後續扣款 fail closed，再嘗試 provider cancellation。PayUni adapter 依官方公開 SDK 的 `credit_bind_cancel`／`credit_bind/cancel` contract 驗證 request envelope 與 signed response；遠端失敗／未支援會保留本機撤銷並留下 sanitized audit。
- Verification: targeted 10 files／79 tests，79 passed；typecheck、scoped ESLint、diff-check PASS；無 schema／migration、staging、PayUni Sandbox、Production 或外部付款操作。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）。setup session 完整欄位契約、PayUni Sandbox receipt、CAT10 真人／外部 evidence 與 recurring／overage orchestration 仍 pending；global coverage 本 WP 未重跑。

## SEC-2026-08-08-01 — Dependency audit refresh

- Evidence: `docs/ai-team/evidence/sec-2026-08-08-01-dependency-audit.md`
- Report: `.ai-team/reports/sec-2026-08-08-01-dependency-audit.json`
- Result: `npm audit --audit-level=high` exit 0，`found 0 vulnerabilities`；沒有修改 dependency files 或品質門檻。
- Boundary: 此為 security evidence，不能取代 PayUni Sandbox、CAT04 reconciliation 或 CAT10 真人 owner acceptance；canonical total remains 73.5，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FUNC-2026-08-08-50 — Production build blocker and webinar ownership boundary

- Evidence: `docs/ai-team/evidence/func-2026-08-08-50-build-and-webinar-boundary.md`
- Report: `.ai-team/reports/func-2026-08-08-50-build-and-webinar-boundary.json`
- Result: 修正 root `use server` module 對 affiliate action 的非直接 re-export，整站 `next build` 恢復；production-like Chromium 以隔離 PostgreSQL 驗證 member A 篡改 member B webinar 後送出發布會被 server 拒絕，且 template/version/source page/webinar snapshot 不變。
- Verification: production build PASS；affiliate action 5/5、team-template action 6/6、ownership E2E 1/1 PASS；typecheck、scoped ESLint、diff-check PASS。test DB 僅套用 pending `20260808060000_payment_method_reference`；本機 dev migration drift 的失敗路徑不列為成功 evidence。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）；PayUni Sandbox／staging reconciliation 與 CAT10 真人／外部 evidence 仍 pending。

## FIN-2026-08-08-51 — Settlement invoice lifecycle and due date

- Evidence: `docs/ai-team/evidence/fin-2026-08-08-51-invoice-lifecycle.md`
- Report: `.ai-team/reports/fin-2026-08-08-51-invoice-lifecycle.json`
- Result: 月結重算不再把既有 paid invoice 倒退為 issued；新 invoice 依 subscription billing cycle 寫入 due date，短月份會安全 clamp 到最後一天。
- Verification: billing 19/19、完整 actions regression 152/152、typecheck、scoped ESLint、diff-check、Next production build 全 PASS；無 schema／migration、staging、PayUni 或 Production 操作。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）；provider-neutral recurring／overage 與 CAT04／CAT10 外部／真人 evidence 仍待完成。

## FIN-2026-08-08-52 — Invoice manual checkout and payment webhook lifecycle

- Evidence: `docs/ai-team/evidence/fin-2026-08-08-52-invoice-payment-lifecycle.md`
- Report: `.ai-team/reports/fin-2026-08-08-52-invoice-payment-lifecycle.json`
- Result: 完成 server-owned invoice checkout、tenant-scoped idempotency、allowlisted PayUni form-post presentation，以及 paid／partial-refund／full-refund webhook 對帳；金額不一致時 fail closed。
- Verification: invoice UI／action／export 14/14、payment webhook 42/42、provider checkout regression 48/48、typecheck、scoped ESLint、diff-check、Next production build 全 PASS。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）；沒有 PayUni Sandbox、staging reconciliation、Production 或真人 CAT10 acceptance，recurring／overage orchestration 仍待完成。

## FIN-2026-08-08-53 — Platform referral commission to owner payout batch integration

- Evidence: `docs/ai-team/evidence/fin-2026-08-08-53-platform-referral-payout-batch.md`
- Report: `.ai-team/reports/fin-2026-08-08-53-platform-referral-payout-batch.json`
- Result: disposable PostgreSQL-backed trusted paid webhook → immutable platform referral commission ledger → owner/month payable → local payout batch 閉環通過；batch claim 與相同 batch number replay 維持 idempotent。
- Verification: payment webhook 43/43、payout/read-model/action/tenant ledger cohort 14/14、typecheck、scoped ESLint、diff-check 全 PASS；無 schema／migration、PayUni Sandbox、staging、Production、外部 payout 或真人簽核。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）；本輪 local finance integration 不取代 CAT04 外部 provider evidence 或 CAT10 真人 owner acceptance。

## FIN-2026-08-08-54 — Billing cycle orchestration and fail-closed invoice regeneration

- Evidence: `docs/ai-team/evidence/fin-2026-08-08-54-billing-cycle-orchestration.md`
- Report: `.ai-team/reports/fin-2026-08-08-54-billing-cycle-orchestration.json`
- Result: 共用 settlement／invoice domain service、上一結算期 billing-cycle job、逾期 invoice 標記與 terminal invoice 金額漂移 fail-closed 已完成；既有 manual checkout 仍是付款邊界，job 不會猜測或呼叫未驗證的 PayUni recurring charge。
- Verification: billing-cycle domain 5/5、job 2/2、route 4/4、完整 actions regression 153/153、finance cohort 57/57、typecheck、Next production build（含 `/api/jobs/billing-cycle`）、scoped ESLint、diff-check 全 PASS。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）；沒有 PayUni Sandbox、staging、Production 或真人 CAT10 acceptance，global coverage 本輪未重算。

## FUNC-2026-08-08-55 — Server-owned monthly usage estimation and idempotent snapshot

- Evidence: `docs/ai-team/evidence/func-2026-08-08-55-server-owned-usage-snapshot.md`
- Report: `.ai-team/reports/func-2026-08-08-55-server-owned-usage-snapshot.json`
- Result: 關閉 `UsageRecord` production writer 缺口；月結與 billing usage page 現在可使用 server-owned stream ledger、analytics、affiliate 與 video estimate，固定 vendor/month snapshot upsert 不會重複計費。
- Verification: usage／billing 4 files 39/39、actions 153/153、finance cohort 5 files 60/60、typecheck、scoped ESLint、diff-check、Next production build 全 PASS。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）；沒有 Cloudflare provider query、PayUni Sandbox、staging、Production 或真人 CAT10 acceptance，global coverage 本輪未重算。

## FUNC-2026-08-08-56 — Finance-scoped webhook reconciliation export

- Evidence: `docs/ai-team/evidence/func-2026-08-08-56-reconciliation-export.md`
- Report: `.ai-team/reports/func-2026-08-08-56-reconciliation-export.json`
- Result: finance-admin webhook detail page 新增 sanitized reconciliation JSON export，包含固定 schema、summary 與 amount／refund／commission checks，不輸出 raw provider payload 或 secret。
- Verification: reconciliation route／detail 2 files、4/4 PASS，typecheck、scoped ESLint、diff-check、Next production build 全 PASS；route manifest 包含 `/admin/billing/webhooks/[id]/reconciliation`。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）；沒有 PayUni Sandbox、staging、Production 或真人 CAT10 acceptance，export 不等同外部 provider acceptance。

## FUNC-2026-08-08-57 — Team membership transfer closure

- Evidence: `docs/ai-team/evidence/func-2026-08-08-57-team-membership-transfer.md`
- Report: `.ai-team/reports/func-2026-08-08-57-team-membership-transfer.json`
- Result: `/settings/team` 新增 atomic team membership transfer；來源 active relationships 在同一 Serializable transaction 結束，目標 inactive membership 可重新啟用，active target conflict fail closed，並保存 bounded audit。
- Verification: team action／page 2 files、9/9 PASS，typecheck、scoped ESLint、diff-check、Next production build 全 PASS；route manifest 包含 `/settings/team`。
- Boundary: canonical total remains 73.5（CAT04 6.0、CAT10 4.5、current goal score change 0）；沒有 schema／migration、PayUni Sandbox、staging、Production、外部付款／payout 或真人 CAT10 acceptance。

## SEC-2026-08-08-58 — Production dependency audit

- Evidence: `docs/ai-team/evidence/sec-2026-08-08-58-production-dependency-audit.md`
- Report: `.ai-team/reports/sec-2026-08-08-58-production-dependency-audit.json`
- Result: `npm audit --omit=dev --json` exit 0；production dependency audit 回報 info／low／moderate／high／critical／total 均為 0，未修改 dependency files 或任何品質門檻。
- Boundary: 此為最新安全 evidence，不能取代 CAT04 PayUni Sandbox／provider reconciliation 或 CAT10 真人 owner／external monitoring evidence；canonical total remains 73.5，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FIN-2026-08-08-59 — Overage manual-payment handoff

- Evidence: `docs/ai-team/evidence/fin-2026-08-08-59-overage-manual-payment-handoff.md`
- Report: `.ai-team/reports/fin-2026-08-08-59-overage-manual-payment-handoff.json`
- Result: Stream 用量達上限時，`/billing/usage` 明確顯示停止新播放的手動付款政策，並提供 `/billing/invoices` 與 `/billing/plans` 入口；10/10、typecheck、scoped ESLint、diff-check、production build PASS。
- Boundary: local finance handoff 不等同 CAT04 PayUni Sandbox／provider reconciliation 或 CAT10 真人 acceptance；canonical total remains 73.5，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## QUAL-2026-08-08-60 — Payment-method source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-08-60-payment-method-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-08-60-payment-method-source-attribution.json`
- Result: 付款方式 onboarding source-attributed targeted suite 7/7 PASS；完整 run 228 test files／1,587 tests PASS、Node contracts 679/679 PASS。付款方式頁 source coverage 為 97.77／96.61／100／97.56。
- Boundary: global combined coverage 43.49／48.92／52.48／62.81 仍低於 63／57／60／65，exit 1 且分類為 `FAIL_REMAINING_SOURCE_INVENTORY`；未降低 threshold、inventory、exclude、skip 或 assertion。canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FIN-2026-08-08-61 — Invoice checkout snapshot fail-closed

- Evidence: `docs/ai-team/evidence/fin-2026-08-08-61-invoice-checkout-snapshot-fail-closed.md`
- Report: `.ai-team/reports/fin-2026-08-08-61-invoice-checkout-snapshot-fail-closed.json`
- Result: provider checkout snapshot 寫回失敗時，帳單 transaction 會 conditional fail closed 為 `failed` 並清除 retry key，避免後續重試重建外部 checkout；相關 8 files／124 tests、scoped ESLint、typecheck、diff-check、production build 全 PASS。
- Boundary: 此為 local finance P1 closure，不等同 CAT04 PayUni Sandbox／provider reconciliation 或 CAT10 真人 acceptance；canonical total remains 73.5，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FIN-2026-08-08-62 — Invoice payment conflict boundary

- Evidence: `docs/ai-team/evidence/fin-2026-08-08-62-invoice-payment-conflict-boundary.md`
- Report: `.ai-team/reports/fin-2026-08-08-62-invoice-payment-conflict-boundary.json`
- Result: invoice payment 的 3 次 Serializable conflict 現在 bounded 導向該帳單 `?error=conflict`，不建立 payment transaction，也不寫成功 audit；相關 8 files／125 tests、scoped ESLint、typecheck、diff-check、production build 全 PASS。
- Boundary: 此為 local finance P1 closure，不等同 CAT04 PayUni Sandbox／provider reconciliation 或 CAT10 真人 acceptance；canonical total remains 73.5，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FUNC-2026-08-08-63 — Billing-plan provider boundary

- Evidence: `docs/ai-team/evidence/func-2026-08-08-63-billing-plan-provider-boundary.md`
- Report: `.ai-team/reports/func-2026-08-08-63-billing-plan-provider-boundary.json`
- Result: billing plan provider unavailable 現在 fail closed 導向專用錯誤狀態，transaction／subscription side effects 維持 0；相關 8 files／129 tests、scoped ESLint、typecheck、diff-check、production build 全 PASS。
- Boundary: 此為 local functional P1 closure，不等同 CAT04 PayUni Sandbox／provider reconciliation 或 CAT10 真人 acceptance；canonical total remains 73.5，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## QUAL-2026-08-08-64 — Billing-plan provider source attribution

- Evidence: `docs/ai-team/evidence/qual-2026-08-08-64-billing-plan-provider-source-attribution.md`
- Report: `.ai-team/reports/qual-2026-08-08-64-billing-plan-provider-source-attribution.json`
- Result: current-tree global run 228 files／1,590 tests PASS、Node contracts 679/679 PASS；billing plans action/page source coverage 87.50／79.41／92.85／87.96 與 92.59／90.90／100／96.00。
- Boundary: global combined coverage 43.51／48.95／52.51／62.84 仍低於 63／57／60／65，exit 1、`FAIL_REMAINING_SOURCE_INVENTORY`；相較 QUAL-60 真實改善 0.02／0.03／0.03／0.03，未降低 threshold、inventory、exclude、skip 或 assertion。canonical total remains 73.5，CAT04=6.0、CAT10=4.5。

## FUNC-2026-08-08-65 — Product create/edit input boundary

- Evidence: `docs/ai-team/evidence/func-2026-08-08-65-product-input-boundary.md`
- Report: `.ai-team/reports/func-2026-08-08-65-product-input-boundary.json`
- Result: 商品建立／編輯 action 改為 server-side fail-closed 驗證價格、比較價格、庫存、active 零價格、幣別、名稱與 slug；負值／小數／非法幣別不會寫入，合法幣別會正規化大寫；11/11 targeted tests、scoped ESLint、typecheck、production build、diff-check 全 PASS。
- Boundary: 這是 local functional P1，不等同 CAT04 PayUni Sandbox／provider reconciliation 或 CAT10 真人／monitoring acceptance；coverage 本包未重跑，沿用 QUAL-64 最新真實結果 43.51／48.95／52.51／62.84 對 63／57／60／65。canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FUNC-2026-08-08-66 — Checkout replay provider boundary

- Evidence: `docs/ai-team/evidence/func-2026-08-08-66-checkout-replay-provider-boundary.md`
- Report: `.ai-team/reports/func-2026-08-08-66-checkout-replay-provider-boundary.json`
- Result: checkout idempotency replay 現在先驗證並回放既有 pending checkout，再解析 current provider；避免 provider 暫時不可用阻擋已存在的 checkout，且新 checkout 的 provider／inventory／metadata fail-closed 邊界保留；25/25 targeted tests、scoped ESLint、typecheck、production build、diff-check 全 PASS。
- Boundary: 這是 local functional P1，不等同 CAT04 PayUni Sandbox／provider reconciliation 或 CAT10 真人／monitoring acceptance；coverage 本包未重跑，沿用 QUAL-64 最新真實結果 43.51／48.95／52.51／62.84 對 63／57／60／65。canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FUNC-2026-08-08-67 — Product URL error boundary

- Evidence: `docs/ai-team/evidence/func-2026-08-08-67-product-url-error-boundary.md`
- Report: `.ai-team/reports/func-2026-08-08-67-product-url-error-boundary.json`
- Result: 商品圖片／結帳 URL 現在與其他欄位共用 server-side fail-closed input parser；非法 URL 導回明確 `invalid_product` alert，不會讓商家遇到未處理 exception 或寫入 malformed product；12/12 targeted tests、scoped ESLint、typecheck、production build、diff-check 全 PASS。
- Boundary: 這是 local functional P1，不等同 CAT04 PayUni Sandbox／provider reconciliation 或 CAT10 真人／monitoring acceptance；coverage 本包未重跑，沿用 QUAL-64 最新真實結果 43.51／48.95／52.51／62.84 對 63／57／60／65。canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FUNC-2026-08-08-68 — Product compare-at price boundary

- Evidence: `docs/ai-team/evidence/func-2026-08-08-68-product-compare-price-boundary.md`
- Report: `.ai-team/reports/func-2026-08-08-68-product-compare-price-boundary.json`
- Result: 商品比較價不得低於實際售價的 server-side 規則已完成；13/13 targeted tests、scoped ESLint、typecheck、production build、diff-check 全 PASS，避免可販售商品顯示反向折扣。
- Boundary: 這是 local functional P1，不等同 CAT04 PayUni Sandbox／provider reconciliation 或 CAT10 真人／monitoring acceptance；coverage 本包未重跑，沿用 QUAL-64 最新真實結果 43.51／48.95／52.51／62.84 對 63／57／60／65。canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## SEC-2026-08-08-69 — Production dependency audit

- Evidence: `docs/ai-team/evidence/sec-2026-08-08-69-production-dependency-audit.md`
- Report: `.ai-team/reports/sec-2026-08-08-69-production-dependency-audit.json`
- Result: `npm audit --omit=dev --json` exit 0；info／low／moderate／high／critical／total 全部 0，未修改 dependency files、lockfile 或品質門檻。
- Boundary: 此為最新 local production dependency audit，不等同 CAT04 PayUni Sandbox／provider reconciliation 或 CAT10 真人／monitoring acceptance；canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## QUAL-2026-08-08-70 — Current-tree coverage baseline

- Evidence: `docs/ai-team/evidence/qual-2026-08-08-70-current-tree-coverage.md`
- Report: `.ai-team/reports/qual-2026-08-08-70-current-tree-coverage.json`
- Result: 228 test files、1,598/1,598 Vitest PASS，Node contracts 679/679 PASS；global coverage 43.54／48.98／52.51／62.85 對既有 63／57／60／65，exit 1 只因 source inventory threshold，沒有 test failure。
- Boundary: 未降低 threshold、inventory、exclude、skip 或 assertion；coverage 不阻擋後續功能／E2E。Canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FIN-2026-08-08-71 — Affiliate dispute provider scope

- Evidence: `docs/ai-team/evidence/fin-2026-08-08-71-dispute-provider-scope.md`
- Report: `.ai-team/reports/fin-2026-08-08-71-dispute-provider-scope.json`
- Result: affiliate dispute webhook 改以 server-owned `PaymentTransaction.id` 精確綁定 commission；同一 vendor／order number／不同 provider regression 44/44 PASS，dispute 不再誤傷另一 provider ledger；ESLint、typecheck、production build（89/89 static pages）、diff-check PASS。
- Boundary: 這是 local finance P1，不等同 CAT04 PayUni Sandbox／staging reconciliation 或 CAT10 真人／monitoring acceptance；canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FIN-2026-08-08-72 — Affiliate refund provider scope

- Evidence: `docs/ai-team/evidence/fin-2026-08-08-72-refund-provider-scope.md`
- Report: `.ai-team/reports/fin-2026-08-08-72-refund-provider-scope.json`
- Result: affiliate refund reconciliation 改以 server-owned `PaymentTransaction.id` 精確綁定 commission；同一 vendor／order number／不同 provider partial refund regression 45/45 PASS，finance regression 47/47 PASS；ESLint、typecheck、production build（89/89 static pages）、diff-check PASS。
- Boundary: 這是 disposable／local finance P1，不等同正式退款、CAT04 PayUni Sandbox／staging reconciliation 或 CAT10 真人／monitoring acceptance；canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FIN-2026-08-08-73 — Webhook reconciliation provider scope

- Evidence: `docs/ai-team/evidence/fin-2026-08-08-73-reconciliation-provider-scope.md`
- Report: `.ai-team/reports/fin-2026-08-08-73-reconciliation-provider-scope.json`
- Result: webhook reconciliation 改以 `event.vendorId + payload.provider + PaymentTransaction.id` 精確綁定交易／佣金；同一 vendor／相同 order number／不同 provider regression 46/46 PASS，reconciliation route regression 48/48 PASS；ESLint、typecheck、production build（89/89 static pages）、diff-check PASS。
- Boundary: 這是 local finance reconciliation P1，不等同 CAT04 PayUni Sandbox／staging reconciliation 或 CAT10 真人／monitoring acceptance；canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FIN-2026-08-08-75 — Invoice checkout lazy provider resolution

- Evidence: `docs/ai-team/evidence/fin-2026-08-08-75-invoice-checkout-lazy-provider.md`
- Report: `.ai-team/reports/fin-2026-08-08-75-invoice-checkout-lazy-provider.json`
- Result: 已有 pending checkout snapshot 時不再解析 provider，避免暫時 provider unavailable 阻擋付款流程回放；invoice action 5/5、ESLint、typecheck、production build（89/89 static pages）、diff-check PASS。
- Boundary: 這是 local finance P1，不等同 CAT04 PayUni Sandbox／staging reconciliation 或 CAT10 真人／monitoring acceptance；canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## QUAL-2026-08-08-74 — Current-tree coverage after finance identity closure

- Evidence: `docs/ai-team/evidence/qual-2026-08-08-74-current-tree-coverage.md`
- Report: `.ai-team/reports/qual-2026-08-08-74-current-tree-coverage.json`
- Result: 228 test files、1,601/1,601 Vitest PASS，Node contracts 679/679 PASS；global coverage 43.54／49.00／52.51／62.86 對既有 63／57／60／65，exit 1 只因 source inventory threshold，沒有 test failure。
- Boundary: 未降低 threshold、inventory、exclude、skip 或 assertion；coverage 不阻擋後續功能／E2E。Canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FIN-2026-08-08-76 — Invoice checkout creation race closure

- Evidence: `docs/ai-team/evidence/fin-2026-08-08-76-invoice-checkout-race.md`
- Report: `.ai-team/reports/fin-2026-08-08-76-invoice-checkout-race.json`
- Result: invoice checkout 遇到另一個 request 已建立 pending transaction、但 checkout snapshot 尚未寫回時，現在回傳 `checkout_in_progress`；不會再次解析 provider 或建立第二個 checkout。invoice action 6/6、ESLint、typecheck、production build（89/89 static pages）、diff-check PASS。
- Boundary: 這是 local finance concurrency P1，不等同 CAT04 PayUni Sandbox／staging reconciliation 或 CAT10 真人／monitoring acceptance；canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FIN-2026-08-08-77 — Invoice checkout in-progress UI closure

- Evidence: `docs/ai-team/evidence/fin-2026-08-08-77-invoice-checkout-progress-ui.md`
- Report: `.ai-team/reports/fin-2026-08-08-77-invoice-checkout-progress-ui.json`
- Result: invoice checkout 的 `checkout_in_progress` 現在顯示明確錯誤狀態，並隱藏重複建立付款交易按鈕；invoice page + action 2 files／14 tests、ESLint、typecheck、Next production build（89/89 static pages）、diff-check PASS。
- Boundary: 這是 local finance UI P1 closure，不等同 CAT04 PayUni Sandbox／staging reconciliation 或 CAT10 真人／monitoring acceptance；canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FUNC-2026-08-08-78 — Custom quota payment-method gate closure

- Evidence: `docs/ai-team/evidence/func-2026-08-08-78-custom-quota-payment-gate.md`
- Report: `.ai-team/reports/func-2026-08-08-78-custom-quota-payment-gate.json`
- Result: `MEMBER + CUSTOM` Stream allocation 現在接受合法 policy，並以 custom membership IDs 執行 verified／non-expired payment reference gate；缺少 reference 時 fail closed、不建立 Live。actions／policy 2 files／158 tests、quota／payment-reference 相關 9 files／65 tests、ESLint、typecheck、production build（89/89 static pages）、diff-check 全 PASS。
- Boundary: 這是 local functional P1 closure，不等同 CAT04 PayUni Sandbox／staging reconciliation 或 CAT10 真人／monitoring acceptance；canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FUNC-2026-08-08-79 — Quota-backed Live share payment gate

- Evidence: `docs/ai-team/evidence/func-2026-08-08-79-live-share-payment-gate.md`
- Report: `.ai-team/reports/func-2026-08-08-79-live-share-payment-gate.json`
- Result: team Live share creation／re-enable 現在重新檢查來源 Live 的 quota payment owner；缺少 verified／未過期 reference 時 bounded fail closed，share upsert=0。focus 4 files／27 tests、expanded team-funnel 8 files／65 tests、ESLint、typecheck、production build（89/89 static pages）、diff-check 全 PASS。
- Boundary: 這是 local functional P1 closure，不等同 CAT04 PayUni Sandbox／staging reconciliation 或 CAT10 真人／monitoring acceptance；canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FUNC-2026-08-08-80 — Live admission payment-ownership gate

- Evidence: `docs/ai-team/evidence/func-2026-08-08-80-live-admission-payment-gate.md`
- Report: `.ai-team/reports/func-2026-08-08-80-live-admission-payment-gate.json`
- Result: quota-backed Live admission／renewal 現在在同一個 Serializable transaction 內重查 payment owner；缺少 reference 時 bounded unavailable，usage limit 不讀取、viewer session 不建立。focus 4 files／25 tests、expanded quota／usage／payment reference／playback 9 files／87 tests、ESLint、typecheck、production build（89/89 static pages）、diff-check 全 PASS。
- Boundary: 這是 local functional P1 closure，不等同 CAT04 PayUni Sandbox／staging reconciliation 或 CAT10 真人／monitoring acceptance；canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FIN-2026-08-08-81 — Invoice payment reconciliation closure

- Evidence: `docs/ai-team/evidence/fin-2026-08-08-81-invoice-reconciliation.md`
- Report: `.ai-team/reports/fin-2026-08-08-81-invoice-reconciliation.json`
- Result: invoice payment reconciliation artifact 新增同商家 invoice identity、invoice total／transaction gross amount、invoice／transaction 狀態三項檢查；invoice reconciliation 3/3、payment webhook 46/46、reconciliation route 2/2，合計 51/51 PASS；ESLint、typecheck、production build（89/89 static pages）、diff-check PASS。
- Boundary: 這是 local finance reconciliation P1 closure，不等同 CAT04 PayUni Sandbox／staging provider receipt 或 CAT10 真人／monitoring acceptance；canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## FIN-2026-08-08-82 — Merchant payout paid-reference closure

- Evidence: `docs/ai-team/evidence/fin-2026-08-08-82-merchant-payout-reference.md`
- Report: `.ai-team/reports/fin-2026-08-08-82-merchant-payout-reference.json`
- Result: merchant payout paid transition 現在要求人工 outcome reference；reference 會保存在 payout item、顯示於 finance admin page 並匯出到 payout CSV，歷史缺漏保留 null。actions／page／CSV 3 files／160 tests、expanded payout／billing 8 files／31 tests、disposable database 2 files／8 tests、33 migrations、Prisma validate／generate、ESLint、typecheck、production build（89/89 static pages）、diff-check 全 PASS。
- Boundary: 這是 local finance P1 closure，不等同 CAT04 PayUni Sandbox／staging provider receipt 或 CAT10 真人 finance／legal／release／monitoring acceptance；canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## SEC-2026-08-08-83 — Production dependency audit and nanoid transitive fix

## FIN-2026-08-08-84 — Affiliate payout paid-reference closure

- Evidence: docs/ai-team/evidence/fin-2026-08-08-84-affiliate-payout-reference.md
- Report: .ai-team/reports/fin-2026-08-08-84-affiliate-payout-reference.json
- Result: affiliate commission payout 的 paid transition 現在要求 1～200 字人工出款／provider outcome reference；reference 保存於 AffiliatePayout、顯示在 affiliate commission page 並寫入 paid audit snapshot，void 會清除 reference。action/page 2 files／160 tests、affiliate payout disposable PostgreSQL 3/3、34 migrations、Prisma validate／generate、scoped ESLint、typecheck、production build（89/89 static pages）與 diff-check PASS。
- Boundary: 這是 local finance P1 closure；不等同 CAT04 authorized staging／PayUni Sandbox transaction、refund／reconciliation evidence，也不等同 CAT10 真人 owner／external monitoring acceptance。canonical total remains 73.5，CAT04=6.0、CAT10=4.5、SANDBOX_READY=false、PRODUCTION_READY=false；此段落完成後停止，不自動重試 FIN-08AA、WP-196 或 WP-197。

- Evidence: `docs/ai-team/evidence/sec-2026-08-08-83-dependency-audit.md`
- Report: `.ai-team/reports/sec-2026-08-08-83-dependency-audit.json`
- Result: latest production dependency audit 初始發現 `nanoid <3.3.17` 的 1 個 high finding；root override `^3.3.17` 後解析為 `3.3.18`，audit high／critical=0、exit 0。安全相關 3 files／22 tests、typecheck、Next production build（89/89 static pages）、full lint（0 errors，2 個既有 warning）與 diff-check PASS。
- Boundary: 這是 local security P1 closure，不等同 CAT04 全新 authorized staging／PayUni Sandbox provider／refund evidence 或 CAT10 真人 owner／external monitoring acceptance；canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## G7-09B — Merchant support case and refund handoff checkpoint

- Evidence: `docs/ai-team/evidence/g7-09b-support-refund-handoff-20260808.md`
- Disposable report: `.ai-team/reports/g7-09b-support-disposable-20260808.json`
- Result: tenant-scoped merchant support queue、encrypted case timeline、owner/status lifecycle 與 finance-only refund handoff 已完成；8 files／27 tests、ESLint、typecheck、Prisma validate、39 migrations／10 PostgreSQL assertions、controlled no-dotenv build（101/101 static pages）與 final P0/P1 review 全 PASS。
- Boundary: merchant support/refund-handoff slice local candidate `8.0/10`；固定 `退款／客服` inventory 仍為 `6.8/10`，因 public buyer safe intake/reply 與 least-privilege support role 尚未完成。Canonical total remains `73.5`、CAT10=`4.5`，沒有 staging/provider/human acceptance 加分。
## G7-10 — 商品目錄、並行庫存與課程 policy snapshot（2026-08-08）

- Evidence：`docs/ai-team/evidence/g7-10-product-catalog-closure-20260808.md`
- Result：商品草稿／失敗保留／主要貨幣單位／媒體上傳 gate／搜尋篩選／商家預覽／商品訂單入口完成；Product revision CAS 與庫存 writer、tenant Slug、外部 checkout 三層 fail-closed、課程 checkout-time F/G policy snapshot 均完成。127 tests、scoped ESLint、TypeScript、受控 production build、41 migration disposable PostgreSQL、8 constraints、7 inventory tests、2 course tests 全 PASS；reviewer 複核 `NO_P0_P1`。
- Boundary：authenticated IAB desktop/mobile/keyboard matrix 為 `NOT_RUN`，不冒充 Browser PASS；canonical total remains 73.5，CAT04=6.0、CAT10=4.5、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## G7-11 — Stream 視覺分潤與配額設定（2026-08-09）

- Evidence：`docs/ai-team/evidence/g7-11-stream-allocation-20260809.md`
- Report：`.ai-team/reports/g7-11-stream-allocation-20260809.json`
- Source manifest：`docs/ai-team/evidence/g7-11-stream-allocation-source-manifest-20260809.txt`
- Result：Live Studio 已用視覺化 `PROMOTER`／`OWNER`／`SPLIT`／`CUSTOM` editor 取代 raw JSON；member／partner-page quota、server-owned affiliate code validation、active-membership gate 與 expired draft revive 完成。13 files／284 tests、ESLint、TypeScript、controlled production build、41 migrations disposable PostgreSQL／2 DB tests、cleanup 與 final reviewer `NO_P0_P1` 全 PASS。
- Boundary：固定 `團隊漏斗／Stream／營運後台` inventory 由 baseline `6.0` 形成 local candidate `7.8/10`；authenticated desktop/mobile/keyboard/Axe Browser、provider usage reconciliation、quota discrepancy notifications 與真人營運流程尚未完成。Canonical total remains `73.5`、CAT04=`6.0`、CAT10=`4.5`，沒有 staging/provider/human acceptance 加分。

## G7-12 — Stream provider 用量對帳與差異營運（2026-08-09）

- Evidence：`docs/ai-team/evidence/g7-12-stream-reconciliation-20260809.md`
- Report：`.ai-team/reports/g7-12-stream-reconciliation-20260809.json`
- Source manifest：`docs/ai-team/evidence/g7-12-stream-reconciliation-source-manifest-20260809.txt`
- Result：provider／internal 月度快照分離、digest-idempotent ingestion、persistent quota／discrepancy alerts、人工 resolution、billing fail-closed 與同 transaction reconciliation CAS 已完成；15 files／122 tests、TypeScript、scoped ESLint、dedicated no-dotenv Prisma validate、controlled production build、42 migrations disposable PostgreSQL／2 DB tests、cleanup 與 final reviewer `NO_P0_P1` 全 PASS。
- Boundary：固定 `團隊漏斗／Stream／營運後台` inventory 形成 local candidate `8.3/10`；目前證據為 `ADMIN_ATTESTED_DIGEST`，不是 provider-signed。Authenticated Browser matrix、authorized Cloudflare／staging provenance、external notification 與真人 owner acceptance 尚未完成。Canonical total remains `73.5`、CAT04=`6.0`、CAT10=`4.5`，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## G7-13B — 表單 Email ownership verification（2026-08-09）

- Evidence：`docs/ai-team/evidence/g7-13b-form-submission-verification-20260809.md`
- Report：`.ai-team/reports/g7-13b-form-submission-verification-20260809.json`
- Source manifest：`docs/ai-team/evidence/g7-13b-source-manifest-20260809.txt`
- Artifact digests：`docs/ai-team/evidence/g7-13b-artifact-digests-20260809.txt`
- Result：報名改為 `UNVERIFIED → VERIFIED` Email ownership flow；只有 verified lead 進 canonical KPI／trusted analytics／affiliate lead conversion。HMAC expiry/version、POST-only mutation、encrypted token delivery、same-origin、server-validated click、one-click-many-forms、legacy defaults 與 concurrent idempotency均完成。15 files／93 tests、44 migrations／4 disposable PostgreSQL tests、Prisma、TypeScript、scoped ESLint、controlled build 與 final reviewer `NO_P0_P1_FINAL` 全 PASS。
- Boundary：production distributed rate limit 仍需 Cloudflare WAF 或正式 provider evidence；沒有執行 staging／Browser／Production。Canonical total remains `73.5`、CAT04=`6.0`、CAT10=`4.5`，Goal remains active。

## G7-14 — 公開結帳 admission 與安全重試（2026-08-09）

- Evidence：`docs/ai-team/evidence/g7-14-checkout-admission-20260809.md`
- Report：`.ai-team/reports/g7-14-checkout-admission-20260809.json`
- Source manifest：`docs/ai-team/evidence/g7-14-source-manifest-20260809.txt`
- Artifact digests：`docs/ai-team/evidence/g7-14-artifact-digests-20260809.txt`
- Result：公開 checkout 現在要求 server-issued、session/product/revision/idempotency-bound admission；direct request、tamper、cross-session、stale revision fail closed。同 admission 併發與 425／5xx／buyer-support 503 retry 只保留一筆 transaction/order/reservation。54 targeted tests、44 migrations／8 disposable PostgreSQL tests、production build、3/3 Chromium、Axe、RWD、TypeScript、ESLint、cleanup 與 final reviewer `NO_P0_P1_FINAL` 全 PASS。
- Boundary：會先取得 admission 的分散式 bot 仍需 Cloudflare WAF／distributed anti-abuse；沒有執行 PayUni Sandbox、staging、Production 或真人簽核。Canonical total remains `73.5`、CAT04=`6.0`、CAT10=`4.5`，Goal remains active；依使用者要求在此 checkpoint 停下。

## G7-15 — 商品管理 Browser 驗收與 Server Action 修復（2026-08-09）

- Evidence：`docs/ai-team/evidence/g7-15-product-catalog-browser-20260809.md`
- Report：`.ai-team/reports/g7-15-product-catalog-browser-20260809.json`
- Source manifest：`docs/ai-team/evidence/g7-15-source-manifest-20260809.txt`
- Artifact digests：`docs/ai-team/evidence/g7-15-artifact-digests-20260809.txt`
- Result：修正 product `use server` initial-state runtime 邊界造成的 validation HTTP 500；tenant-scoped duplicate Slug 可復原且保留 DB race barrier。商品 upload recovery、草稿、上架、預覽、外部 checkout、搜尋篩選、foreign product 404、desktop/mobile、keyboard 與 Axe 完成。33 targeted tests、5 runner contract tests、44 migrations、production build、5/5 具名 Chromium contracts、source lineage、cleanup 與 final reviewer `NO_P0_P1_FINAL` 全 PASS。
- Boundary：固定 `商品管理` inventory 形成 local candidate `8.0/10`；正式 media provider、staging、Production 與真人 acceptance 未執行。Canonical total remains `73.5`、CAT04=`6.0`、CAT10=`4.5`，Goal remains active；依使用者要求在此 checkpoint 停下。

## G7-16 — 固定功能 scorecard 與 canonical reconciliation（2026-08-09）

- Evidence：`docs/ai-team/evidence/g7-16-function-scorecard-reconciliation-20260809.md`
- Report：`.ai-team/reports/g7-16-function-scorecard-reconciliation-20260809.json`
- Scorecard：`docs/launch/current-function-scorecard-20260809.json`
- Source manifest：`docs/ai-team/evidence/g7-16-source-manifest-20260809.txt`
- Result：固定 12 項 inventory 沒有縮減，全部 local candidate >=7；4/4 executable scorecard contracts、canonical reconciliation、ESLint 與 reviewer `NO_P0_P1_FINAL` PASS。
- Boundary：canonical 維持 73.5，低於 7 的只有 CAT04=6.0 與 CAT10=4.5；外部／真人 blocker 不由 AI 代簽。下一自主 lane 為 QUAL_CLOSURE。

## G7-17 — current-tree coverage truth 與測試收斂（2026-08-09）

- Evidence：`docs/ai-team/evidence/g7-17-qual-coverage-reconciliation-20260809.md`
- Report：`.ai-team/reports/g7-17-qual-coverage-reconciliation-20260809.json`
- Source manifest：`docs/ai-team/evidence/g7-17-source-manifest-20260809.txt`
- Artifact digests：`docs/ai-team/evidence/g7-17-artifact-digests-20260809.txt`
- Result：coverage runner 改用 44 migrations 的 loopback disposable PostgreSQL；Vitest 308/308 files、2,074/2,074 tests 與 Node TAP 698/698 全 PASS，TypeScript、ESLint、精確 cleanup 通過。API registry 45/45、Prisma inventory 84 models／44 migrations，root action module 2,229 行低於既有 2,300 上限。
- Boundary：coverage gate 如實 FAIL，statements 43.87%、branches 48.51%、functions 52.52%、lines 61.74%；門檻未降低。89.94% 未覆蓋 statements 來自 `scripts/**`，下一 lane 為 script source-attribution tests。Canonical remains 73.5、CAT04=6.0、CAT10=4.5，Goal active；依使用者要求在此 checkpoint 停下。

## G7-18 — Browser runner source attribution 與 cleanup ownership（2026-08-09）

- Evidence：`docs/ai-team/evidence/g7-18-browser-runner-source-attribution-20260809.md`
- Report：`.ai-team/reports/g7-18-browser-runner-source-attribution-20260809.json`
- Source manifest：`docs/ai-team/evidence/g7-18-source-manifest-20260809.txt`
- Artifact digests：`docs/ai-team/evidence/g7-18-artifact-digests-20260809.txt`
- Result：G7-04／G7-05 Browser runner 新增 14 個 failure、sanitization、hermetic env、container ownership 與 exact temp cleanup contracts；targeted 23/23、完整 Node TAP 712/712、Vitest 308 files／2,074 tests、TypeScript、ESLint 與 disposable cleanup 全 PASS。G7-05 只有 exact ID／name／labels／tmpfs／database marker／schema marker 全部吻合才允許移除 container。
- Boundary：coverage gate 如實維持 FAIL，但 statements 43.87%→44.09%、branches 48.51%→48.81%、functions 52.52%→52.77%、lines 61.74%→61.96%，兩個 runner uncovered statements 淨減 72。沒有執行 Browser／staging／PayUni／Production，canonical 維持 73.5。依最新指示，下一 lane 改為產品功能缺口，不再優先追 coverage；CAT04／CAT10 人工與外部路徑先保留 blocker。

## G7-19 — Checkout payment return accepted local（2026-08-09）

- Evidence：`docs/ai-team/evidence/g7-19-checkout-payment-return-checkpoint-20260809.md`
- Source manifest：`docs/ai-team/evidence/g7-19-source-manifest-20260809.txt`
- Artifact digests：`docs/ai-team/evidence/g7-19-artifact-digests-20260809.txt`
- Final Browser receipt：`docs/ai-team/evidence/g7-04-browser-qa-f450f482f8b58599.json`
- Result：PayUni payer return 改為同源 303 安全結果頁，Notify JSON ack 保持不變；結果頁以 buyer capability 顯示遮罩訂單與實際付款狀態。123/123 targeted tests、12/12 runner tests、scoped ESLint、hermetic production build、44 migrations、5/5 Browser contracts、Axe 0、RWD、tenant isolation、PII leak 與 cleanup 全 PASS。
- Boundary：production Secure capability 在 HTTP loopback 使用明確記錄的 synthetic TLS bridge；未執行 staging HTTPS／PayUni Sandbox，不冒充外部驗收、不主張加分，canonical 維持 73.5。

## G7-20 — Finance async feedback accepted local（2026-08-09）

- Evidence：`docs/ai-team/evidence/g7-20-finance-async-feedback-20260809.md`
- Source manifest：`docs/ai-team/evidence/g7-20-source-manifest-20260809.txt`
- Artifact digests：`docs/ai-team/evidence/g7-20-artifact-digests-20260809.txt`
- Final Browser receipt：`docs/ai-team/evidence/g7-04-browser-qa-672e2b6fcf0940e4.json`
- Result：course／platform referral payout、payment method、webhook retry 與 affiliate commission void 補齊 pending、disabled、防重送、確認與可存取狀態；billing segment 新增不洩漏錯誤內容的 loading／error recovery。12 files／48 tests、12/12 runner、scoped ESLint、44 migrations、production build、6/6 Browser contracts、Axe 0、RWD、安全邊界、current-tree source lineage 與 cleanup 全 PASS。固定 finance 功能分由 7.0 重算為 7.5。
- Boundary：沒有執行 staging／PayUni Sandbox／Production 財務操作，CAT04 與 CAT10 仍保留外部及真人 blocker；canonical 維持 73.5，Goal remains active。

## G7-21 — Email scheduler and live reminder accepted local（2026-08-09）

- Evidence：`docs/ai-team/evidence/g7-21-email-scheduler-live-reminder-20260809.md`
- Report：`.ai-team/reports/g7-21-email-scheduler-live-reminder-20260809.json`
- Disposable PostgreSQL：`.ai-team/reports/g7-21-email-disposable-20260809.json`
- Source manifest：`docs/ai-team/evidence/g7-21-source-manifest-20260809.txt`
- Artifact digests：`docs/ai-team/evidence/g7-21-artifact-digests-20260809.txt`
- Final Browser receipt：`docs/ai-team/evidence/g7-04-browser-qa-f569709aa8e496dc.json`
- Result：Email template 明確分離 registration／live reminder；Live Studio 保存 reminder template／offset；verified registration 建立 immutable、deterministic reminder delivery，支援 suppression 與 revision supersede；Vercel Cron GET 使用獨立 `CRON_SECRET`，人工 job POST 保留 `JOB_SECRET`。14 files／299 tests、13/13 runner、45 migrations／2 DB tests、scoped ESLint、production build、7/7 Browser、Axe 0、RWD、41 source hashes 與 cleanup 全 PASS。固定 Email 功能分由 7.0 重算為 7.8。
- Boundary：Production cron、真實 provider delivery／bounce 與真人 release acceptance 未執行；既有 verified registrations 在直播設定改動後的 durable reminder reconciliation 留作後續 P1。Canonical 維持 73.5，CAT04=6.0、CAT10=4.5。

## G7-22 — Merchant onboarding ready-media accepted local（2026-08-09）

- Evidence：`docs/ai-team/evidence/g7-22-onboarding-ready-media-20260809.md`
- Report：`.ai-team/reports/g7-22-onboarding-ready-media-20260809.json`
- Source manifest：`docs/ai-team/evidence/g7-22-source-manifest-20260809.txt`
- Artifact digests：`docs/ai-team/evidence/g7-22-artifact-digests-20260809.txt`
- Result：商家 onboarding 的可販售直播現在必須具備同商家且可播放的 URL／Stream／server-created Live Input 媒體；沒有影片或 processing 狀態維持 4/5、80%、非 complete。3 files／10 tests、scoped ESLint 與 diff-check 全 PASS。
- Boundary：onboarding 固定功能維持 8.0，這次關閉 P1 false-positive，不以修正可信度硬加分；沒有執行正式 Cloudflare、staging 或 Production。Canonical 維持 73.5。

## G7-23 — Live reminder durable reconciliation accepted local（2026-08-09）

- Evidence：`docs/ai-team/evidence/g7-23-live-reminder-reconciliation-20260809.md`
- Report：`.ai-team/reports/g7-23-live-reminder-reconciliation-20260809.json`
- Disposable PostgreSQL：`.ai-team/reports/g7-23-live-reminder-reconciliation-disposable-20260809.json`
- Controlled production build：`.ai-team/reports/g7-23-live-reminder-controlled-build-20260809.json`
- Source manifest：`docs/ai-team/evidence/g7-23-source-manifest-20260809.txt`
- Source digests：`docs/ai-team/evidence/g7-23-source-digests-20260809.txt`
- Artifact digests：`docs/ai-team/evidence/g7-23-artifact-digests-20260809.txt`
- Result：既有 VERIFIED registrations 在直播 schedule、template、offset、status、title 變更後由 durable tenant-scoped job 重新整理 reminder；支援 A→B→A unsent reactivation、stale schedule/title worker guard、lease recovery、cancel 與 send-time current check。6 files／242 tests、46 migrations／8 DB tests、TypeScript、scoped ESLint、controlled production build 與 final reviewer `NO_P0_P1_FINAL` 全 PASS。
- Score：Email 固定功能 7.8→8.2；CAT01 7.5→8.0；canonical total 73.5→74.0。CAT04=6.0、CAT10=4.5，Goal remains active。
- Boundary：Production cron、真實 Email provider／bounce、CAT04 staging／PayUni Sandbox 與 CAT10 真人簽核未執行；FIN-08AA、WP-196、WP-197 禁止路徑未重試。

## G7-24 — Checkout and payment recovery accepted local（2026-08-09）

- Evidence：`docs/ai-team/evidence/g7-24-checkout-recovery-20260809.md`
- Report：`.ai-team/reports/g7-24-checkout-recovery-20260809.json`
- Controlled production build：`.ai-team/reports/g7-24-checkout-recovery-controlled-build-20260809.json`
- Source manifest：`docs/ai-team/evidence/g7-24-source-manifest-20260809.txt`
- Source digests：`docs/ai-team/evidence/g7-24-source-digests-20260809.txt`
- Artifact digests：`docs/ai-team/evidence/g7-24-artifact-digests-20260809.txt`
- Result：payment_failed／expired 取得 server-owned retry CTA；provider readiness 在商品訂單、inventory、invoice transaction 與 paid-plan pending subscription 建立前 fail closed；沒有付款目的地的 ready session 會執行 scoped compensation。10 files／133 tests、TypeScript、scoped ESLint、controlled production build 與 reviewer `NO_P0_P1` 全 PASS。
- Score：Checkout／付款固定功能 7.5→8.0；canonical 維持 74.0，CAT04=6.0、CAT10=4.5，Goal remains active。
- Boundary：PayUni Sandbox、staging、Production 與真人驗收未執行；unsupported provider bounded JSON response 保留為 P2；FIN-08AA、WP-196、WP-197 禁止路徑未重試。

## G7-48 — Product delivery and exact buyer access accepted local（2026-08-09）

- Evidence：`docs/ai-team/evidence/g7-48-product-delivery-buyer-access-20260809.md`
- Final Browser receipt：`docs/ai-team/evidence/g7-48b-buyer-delivery-browser-qa-c0de9982255ebec7.json`
- Receipt SHA-256：`d2cda72dcfd95076343ecf5f33c845101450b34096780822e53cbb7483308768`
- Result：商家可為 digital／course／service 設定付款後內容；destination／instructions 加密並保存 immutable order-item snapshot。買家經 exact HttpOnly order grant、paid order、active fulfillment、non-revoked snapshot與fresh allowlist revalidation後，才可使用同源領取頁。全額退款撤銷 snapshot／entitlement並清除 access envelope；legacy order顯示客服fallback。
- Verification：targeted 5 files／39 tests、final unavailable-state 5 files／31 tests、runner 18/18、fresh Prisma generate、51 migrations、Next production build、1/1 Browser、Axe 0、desktop／mobile RWD、4 screenshot digests與cleanup全PASS。人工檢視拒絕了一張loading-state mobile圖，最終receipt已等待完整內容後重新取證。
- Score：CAT01 8.0→8.5；canonical total 74.0→74.5。商品管理 8.0→8.5、Checkout／付款 8.6→8.8、訂單／履約 8.7→9.2、退款／客服 8.3→8.7。
- Boundary：僅本機 loopback／disposable PostgreSQL／demo provider synthetic evidence；CAT04維持6.0、CAT10維持4.5，Goal remains active。未執行staging、PayUni Sandbox、Production、正式付款／退款、push、merge或terminal no-go retry。

## G7-49 — Merchant onboarding exact sales-live readiness accepted local（2026-08-10）

- Evidence：`docs/ai-team/evidence/g7-49-merchant-onboarding-live-readiness-20260810.md`
- Final Browser receipt：`docs/ai-team/evidence/g7-49-onboarding-browser-qa-532104134ca28812.json`
- Receipt SHA-256：`631be1444bced702dee10f067d01a2c1a001c4ff551fcc1f7d96e33fca1864d8`
- Result：商家 onboarding 顯示可販售直播的媒體、表單、Email、互動腳本與直播綁定缺口，每項都有直接修復 CTA；付款方式仍為必要項目，但不搶先阻擋可在產品內完成的工作。內容直播發布規則保持獨立。
- Verification：6 files／27 targeted tests、runner 19/19、scoped ESLint、fresh Prisma generate、51 migrations、Next production build、1/1 Browser、2/5→payment-only 3/5 不得假完成→2/5→4/5→5/5、跨租戶隔離、Axe 0、desktop／mobile RWD 與 cleanup 全 PASS；final reviewer `ELIGIBLE_CAT02_PLUS_0_5`，P0/P1 皆 0。
- Score：商家 onboarding／設定 8.4→8.7；CAT02 8.0→8.5；canonical total 74.5→75.0。
- Boundary：僅本機 loopback／disposable PostgreSQL／synthetic payment reference；CAT04維持6.0、CAT10維持4.5，Goal remains active。未執行staging、PayUni Sandbox、Production、正式付款、push、merge或terminal no-go retry。

## G7-50 — Stream quota exhaustion playback stop accepted local（2026-08-10）

- Evidence：`docs/ai-team/evidence/g7-50-stream-quota-playback-stop-20260810.md`
- Final Browser receipt：`docs/ai-team/evidence/g7-50-stream-quota-browser-qa-e9604ab982f9b99a.json`
- Receipt SHA-256：`616b1160940caca459606b218bf04d30a5646f7a6a0e3c6fa6837612bda1f2dc`
- Result：exact Stream 額度耗盡會停播、停止 heartbeat 重送、移除 controls 並顯示 accessible 復原提示；generic 429 不會誤停，商品／報名／聊天導覽仍可操作。
- Verification：3 files／48 targeted tests、runner 20/20、TypeScript、scoped ESLint、fresh Prisma generate、51 migrations、production build、1/1 Browser、Axe 0、desktop／mobile RWD、2 screenshot digests 與 cleanup 全 PASS；final reviewer `NO_P0_P1_WITH_P2`。
- Score：`team_stream_operations` 維持9.1、CAT01維持8.5、CAT08維持7.5、canonical total維持75.0。P2為一般失敗尚缺獨立retry／backoff及component／Browser重送證據。
- Boundary：僅本機 loopback／disposable PostgreSQL／synthetic quota response；CAT04維持6.0、CAT10維持4.5，Goal remains active。未執行真實Cloudflare reconciliation、staging、Production、正式付款／退款、push、merge或terminal no-go retry；依使用者指示在此checkpoint停止。

## G7-51 — Stream heartbeat timeout、冪等重試與 quota source cancellation accepted local（2026-08-10）

- Evidence：`docs/ai-team/evidence/g7-51-stream-heartbeat-reliability-20260810.md`
- Final retry receipt：`docs/ai-team/evidence/g7-51-stream-retry-browser-qa-219b00b4693552be.json`，SHA-256 `961f299258ef39535eca62341cb0f1db29036d218c62962d5aec27d5bc2bb504`。
- Final quota receipt：`docs/ai-team/evidence/g7-50-stream-quota-browser-qa-c3429009491880d7.json`，SHA-256 `2b99691c43cd291af4dea6fad67cc057eb1506d3b5deb2573d6f50f67e7f9ad3`。
- Result：heartbeat 永久 pending 會在 2 秒 timeout／abort 後以相同eventId進入bounded retry；event-derived jitter分散同步重試，retry budget用完後不會形成timeupdate request storm。Exact quota會pause、撤除來源並卸載播放器，等待3秒後heartbeat仍只有一筆，accessible復原提示與其他互動保持可用。
- Verification：3 files／54 targeted tests、runner 21/21、TypeScript、scoped ESLint、兩個fresh focused Browser各1/1、51 migrations、production build、Axe 0、desktop／mobile RWD、4 screenshot digests與cleanup全PASS；兩份final receipt使用相同source lineage。保留`g7-50-stream-quota-browser-qa-89b1f6494b9d1599.json`為currentSrc未清除的真實FAIL；final reviewer無P0／P1／release-blocking P2。
- Score：CAT08 7.5→8.0、canonical total 75.0→75.5；`team_stream_operations` 9.1→9.4。CAT01維持8.5，避免同份證據重複計分。
- Boundary：`npm run typecheck:strict-index`仍因10個既有非G7-51錯誤exit 1，已如實保存；真實Cloudflare usage reconciliation、external telemetry、staging、Production與真人acceptance未執行。CAT04維持6.0、CAT10維持4.5，Goal remains active；未執行正式付款／退款、push、merge或terminal no-go retry。

## G7-52 — Interaction role preview and impact accepted local（2026-08-10）

- Evidence：`docs/ai-team/evidence/g7-52-interaction-role-preview-impact-20260810.md`
- Final Browser receipt：`docs/ai-team/evidence/g7-52-interaction-role-browser-qa-56b3e9706e8b2648.json`
- Receipt SHA-256：`fe583c8551b26c845d7fb8b8f1813d24d940030b8ef2da081e40a78b5054dc8f`。
- Result：商家可即時預覽互動角色，看到透明身分說明、引用腳本／事件／同商家直播數，以及停用或刪除影響。修正invalid form可跳過destructive confirmation的P1，並以vendor-filtered relation count阻擋跨租戶aggregate洩漏。
- Verification：4 files／20 targeted tests、runner 22/22、TypeScript、scoped ESLint、fresh Prisma generate、51 migrations、production build、1/1 Browser、destructive cancel後DB角色仍存在、foreign-live污染隔離、tenant isolation、Axe 0、desktop／mobile RWD、2 screenshot digests與cleanup全PASS；final reviewer無P0／P1／release-blocking P2。
- Score：`interaction_roles` 8.1→8.5；canonical total維持75.5，避免將單一功能證據重複計入CAT01／CAT03／CAT06／CAT07。
- Boundary：`npm run typecheck:strict-index`仍因7個既有非G7-52錯誤exit 1；大量event的application-side aggregate保留為P3。CAT04維持6.0、CAT10維持4.5，Goal remains active；未執行staging、Production、正式付款／退款、push、merge或terminal no-go retry。

## G7-53 — Registration form draft recovery and optimistic conflict accepted local（2026-08-10）

- Evidence：`docs/ai-team/evidence/g7-53-registration-form-draft-recovery-20260810.md`。
- Final Browser receipt：`docs/ai-team/evidence/g7-53-form-draft-browser-qa-5088a7b2f2678e59.json`，SHA-256 `ef88021952cdcedbde74353f911f632bed07c717d28a1d4b692fcd37bbfa0023`。
- Result：商家表單支援tenant／form scoped瀏覽器草稿、自動保存、恢復／捨棄、成功後清除與一般server失敗後復原；編輯使用`updatedAt` CAS，舊分頁不能覆蓋新版，stale草稿不提供直接恢復。
- Verification：13 files／73 targeted tests、runner 11/11、TypeScript、scoped ESLint、fresh Prisma generate、51 migrations、production build、9/9 Browser、same-browser cross-tenant isolation、server-failure recovery、CAS DB保留、stale fail-closed、Axe 0、desktop／mobile RWD、2 screenshot digests與cleanup全PASS；final reviewer `ELIGIBLE_NO_P0_P1_P2`。
- Score：`registration_form_builder` 8.2→8.7；canonical total維持75.5，避免將單一表單的本機證據重複計入已有onboarding evidence的CAT02，且CAT06完整staging matrix仍pending。
- Boundary：`npm run typecheck:strict-index`仍因7個既有非G7-53錯誤exit 1；CAT04維持6.0、CAT10維持4.5，Goal remains active。未執行staging、PayUni Sandbox、Production、正式付款／退款、push、merge或terminal no-go retry。

## G7-54 — Registration submission search, filters and bounded pagination accepted local（2026-08-10）

- Evidence：`docs/ai-team/evidence/g7-54-form-submission-search-20260810.md`。
- Final Browser receipt：`docs/ai-team/evidence/g7-54-form-submissions-browser-qa-f9ecdd7f7e025c5f.json`，SHA-256 `34d61193df8cb6e92f735bb1a4267a1081aa2cd95b678cbac239f161a176439c`。
- Result：商家可用姓名／Email／手機搜尋，依驗證狀態與直播／獨立表單來源篩選並每頁25筆瀏覽；PII不進URL。修正`name="reset"`遮蔽原生form reset造成第二次Server Action崩潰的production bug；表單首頁改用DB count／groupBy。
- Performance：新增`pg_trgm`與name／Email／phone三個GIN indexes，search-index contract與89-model／52-migration inventory PASS。
- Verification：6 files／18 targeted tests、runner／index contracts 13/13、TypeScript、scoped ESLint、52 migrations、production build、5/5 Browser、55-row pagination、Axe 0、desktop／mobile RWD、keyboard、loading、CSRF error、tenant noindex／no-leak、2 screenshot digests與cleanup全PASS；P2修正後final reviewer `ELIGIBLE`。
- Score：`registration_form_builder` 8.7→9.1；canonical total維持75.5，避免重複計入CAT02／CAT06／CAT07。
- Boundary：CAT04維持6.0、CAT10維持4.5，Goal remains active。未執行staging、PayUni Sandbox、Production、正式資料、外部Email、push、merge或terminal no-go retry。

## G7-55 — Email merchant operations local verified, Browser partial（2026-08-10）

- Evidence：`docs/ai-team/evidence/g7-55-email-merchant-operations-20260810.md`。
- Disposable receipt：`.ai-team/reports/g7-55-email-operations-disposable-20260810.json`，SHA-256 `b9f665038d858fc87194dd0c1e3b43ed1e7620a50808dd4464a0e7c522dfec2f`。
- Latest Browser receipt：`docs/ai-team/evidence/g7-55-email-operations-browser-qa-d41514a26aa30a11.json`，SHA-256 `109112632aac9df403969925f25564dd55a6a05a5dc32f013d7f88ae10b98c4e`，結果 `BLOCKED_OR_FAILED`、2/5。
- Result：商家可安全搜尋、篩選、分頁查看遮罩 Email delivery，failed與安全 exhausted可 durable requeue；永久拒絕、退訂、被新版取代與已寄送狀態保持fail closed。失敗action明示舊快照。
- Verification：53 migrations、4/4 disposable DB、10 files／40 tests、runner contracts 6/6、TypeScript、scoped ESLint、受控 production build與cleanup通過。Browser已證明search、URL privacy、pagination、requeue、provider rejection、pending、tenant isolation、mobile RWD與Axe 0；filter／keyboard／CSRF runner時序已修但未重跑。
- Score：Email固定功能8.2→8.6；canonical維持75.5，CAT04=6.0、CAT10=4.5。
- Pause：依使用者要求不再開下一個WP；Goal保持active。完整進度見`docs/ai-team/evidence/goal-progress-pause-20260810.md`。

## REL-20260820 — Current-tree release reconciliation and disposable backup／restore（2026-08-20）

- Evidence：`docs/ai-team/evidence/goal-continuation-release-reconciliation-20260820.md`
- Disposable receipt：`.ai-team/reports/staging-backup-restore-disposable-receipt.json`
- Result：修正 contract drift、dead code 與 combined coverage merge 的重複 script placeholder；新增 tmpfs／loopback-only、explicit environment 的 disposable PostgreSQL schema/data backup／restore drill。58 migrations、migration status、aggregate／extension snapshot compare、source／target／temp cleanup 全部 `PASS`。
- Verification：ESLint `0 errors／0 warnings`、TypeScript、controlled production build、local release verifier、local rollback rehearsal、backup tooling static checks 通過；Node TAP `762 passed／0 failed／0 skipped`；combined coverage `403 files passed／1 skipped`、`3073 passed／1 skipped`，初次 reconciliation 的 statements／branches／functions／lines=`64.18／63.80／70.33／69.04`，threshold=`63／57／60／65`。
- Boundary：這是 local／disposable evidence，不代表 Supabase platform restore、實際 staging restore、PITR、Production recovery、PayUni Sandbox reconciliation 或 external provider evidence。Cloudflare、Resend、Sentry、PostHog、durable rate limit、staging Browser matrix、法務／客服／退款／隱私與人工 owner acceptance 仍 pending；Goal remains active，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## REL-20260821-G7-55 — Email operations Browser rerun（2026-08-21）

- Receipt：`docs/ai-team/evidence/g7-55-email-operations-browser-qa-4d9c1276b5dc9719.json`
- Result：修正 keyboard focus／Tab 流程、保留 failed／live reminder filters，並將 expired CSRF assertion 限定在 Email delivery 主表單；fresh local runner 為 `PASS`，5/5 Browser、0 failed、0 skipped、Axe critical／serious `0`、desktop／mobile RWD、filters、keyboard、CSRF、tenant isolation 與 exact cleanup 全通過。
- Boundary：此 receipt 只證明 local disposable Browser flow；Resend 真實寄信、staging Browser matrix、Cloudflare、PayUni Sandbox、Production 與人工 owner acceptance 仍未驗證。Goal remains active，canonical total 維持 `75.5`。

## REL-20260821-RT01 — RT-01-D2 live-chat disposable refresh（2026-08-21）

- Receipt：`.ai-team/reports/rt01-live-chat-disposable-receipt.json`；fresh run 後以 canonical absolute path 執行 `--verify-receipt` 通過。
- Result：current tree 的 58 migrations、validate／deploy／status／migration state、live-chat DB suite `1/1`、container／temp cleanup 全部 `PASS`；sourceEnv／raw output／persistent volume／Production side effect safety flags 全部保持安全值。
- Boundary：這是 local disposable PostgreSQL evidence，只補強 live-chat data contract；不等同 actual staging restore、Production recovery、外部服務驗證、PayUni Sandbox reconciliation 或人工 acceptance，canonical total 不變。

## REL-20260821-RC-FREEZE — Local release candidate freeze（2026-08-21）

- Commit：`b70539f`，394 個可見 source／test／migration／evidence 檔案已用明確 inventory 凍結，未 push、merge 或 deploy。
- Verification：`secret_scan_passed`、`git diff --check=PASS`；commit 後 `git status --short`、staged index 與 `git diff HEAD` 均 clean。
- Boundary：這是 local RC source-tree freeze；PayUni Sandbox reconciliation、Cloudflare／Resend／Sentry／PostHog／durable rate limit external evidence、實際 staging recovery、staging Browser matrix與人工 owner acceptance仍未完成，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## REL-20260821-FINAL-GATES — Frozen HEAD final gate rerun（2026-08-21）

- Source：RC source commit `b70539f`；evidence-only 文件更新前重新驗證，未操作 staging、Production、正式付款／退款／寄信或外部 provider。
- Verification：ESLint `0 errors／0 warnings`、TypeScript、secret scan、`git diff --check`、controlled production build、local release verifier、Node TAP `762 passed／0 failed／0 skipped` 全部通過；combined coverage `403 files passed／1 skipped`、`3073 passed／1 skipped`，statements／branches／functions／lines=`64.13／63.78／70.09／69.02`，threshold=`63／57／60／65`。
- Boundary：local release verifier 為 `verified` 但 application environment availability 全為 `false`。PayUni Sandbox reconciliation、Cloudflare／Resend／Sentry／PostHog／durable rate limit external evidence、實際 staging recovery、staging Browser matrix與法務／客服／退款／隱私／人工 owner acceptance仍 pending；`PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`，Goal remains active。

## REL-20260821-STAGING-READONLY — Staging read-only health probe（2026-08-21）

- Evidence：`docs/ai-team/evidence/rel-20260821-staging-readonly-health.md`
- Result：staging `/api/health` HTTP `200`、`ok=true`、`database=ok`；公開 `/` HTTP `200`；未帶認證的 `/api/admin/preflight` HTTP `401`，protected boundary 正常。
- Boundary：WP-187 lineage marker 回 HTTP `200` 但不是預期 JSON contract，current RC `b70539f` deployment identity 未證明；沒有執行 migration、backup／restore／rollback、外部 provider、PayUni、付款、退款、寄信或部署寫入。`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## REL-20260821-COMPLETION-AUDIT — Requirement-by-requirement release audit（2026-08-21）

- Audit：`docs/launch/current-release-completion-audit-20260821.md`
- Result：逐項對照 local CI／RC、staging migration／recovery、Cloudflare、Resend、Sentry、PostHog、durable rate limit、PayUni reconciliation、政策、客服 escalation 與真人 owner acceptance；所有未完成項目保留 `NOT_PROVEN`、`PENDING_EXTERNAL` 或 `PENDING_HUMAN`，並附 provenance、風險與下一個安全動作。
- Boundary：audit 明確維持 `ENGINEERING_READY=true`、`PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`、`releaseDecision=NO_GO`；沒有新增外部、Production、付款、退款、寄信或部署 side effect。

## REL-20260821-SCORE-FRESHNESS — Solo Founder launch score freshness（2026-08-21）

- Report：`docs/launch/solo-founder-launch-score.json` 的 `asOf` 更新至 `2026-08-21`，並明確指向 `docs/launch/current-release-completion-audit-20260821.md`；Solo Founder score 維持 `68.65`，`scoreAppliedToCanonical=false`。
- Verification：report test 會確認 audit 檔案存在、日期一致，且仍保留 `releaseDecision=NO_GO`；未調整 canonical total、readiness flags 或任何 blocker。
- Boundary：這是 evidence freshness／traceability 修正，不新增 staging、外部 provider、PayUni、Production 或真人 acceptance 證據；Goal remains active。

## REL-20260821-RELEASE-GATE-HANDOFF — Current non-Production gate handoff（2026-08-21）

- Handoff：`docs/launch/current-release-gate-handoff-20260821.md`
- Result：將 exact staging lineage、migration、backup／restore、rollback／forward、Cloudflare、Resend、Sentry、PostHog、durable rate limit、PayUni Sandbox 與 CAT10 human acceptance 的最小 evidence、owner authorization、stop conditions 與 sanitized receipt boundary 集中整理。
- Verification：handoff contract `1/1`、完整 `npm run test:contracts` `763 passed／0 failed／0 skipped`、`npm run test:coverage` exit `0`；combined statements／branches／functions／lines=`64.18／63.79／70.33／69.04`，threshold=`63／57／60／65`。
- Boundary：文件狀態為 `READY_FOR_AUTHORIZED_NON_PRODUCTION_EXECUTION`，不代表任何外部 gate 已通過；禁止重跑 FIN-08AA、WP-196、WP-197 與既有 PayUni external smoke 失敗路徑，readiness flags 與 `releaseDecision=NO_GO` 維持不變。

## REL-20260821-RELEASE-ENV-INVENTORY — Release verifier environment inventory（2026-08-21）

- Source candidate：`bc2e4ab`；修改 `scripts/release-local-readiness.mjs` 與對應 test，讓 local release verifier 以 presence-only boolean 回報 preflight 需要的 `CRON_SECRET`、`LIVE_CHAT_INGRESS_SECRET`、PayUni、Cloudflare、Upstash、Sentry 與其他 release-critical bindings。
- Verification：targeted `release-local-readiness` tests `5/5`、full lint、TypeScript、strict-index、Node TAP `763/763`、combined coverage exit `0`（`64.18／63.79／70.33／69.04`）、controlled production build、secret scan、readiness truth 與 local release verifier 均通過；verifier 明確回報 `PAYMENT_PROVIDER=false`。
- Boundary：只保存 presence boolean，不保存環境值；PayUni `PAYUNI_ENV=sandbox` 的 non-secret class 可辨識，但因 `PAYMENT_PROVIDER=false`、staging DB identity 缺失與 provider account／order binding 未驗證，`PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false` 維持不變。

## REL-20260821-PAYUNI-ENV-BINDING — PayUni deployment boundary gate（2026-08-21）

- Source candidate：`3d2b54c`；`src/lib/env.ts` 將 PayUni `PAYUNI_ENV` 與 deployment boundary 綁定，對應測試補上 Preview mismatch、Preview sandbox、Production mismatch 與 Production pass 的 synthetic matrix。
- Verification：env targeted test `33/33`、full lint、TypeScript、strict-index、Node TAP `763/763`、combined coverage `3075 passed／1 skipped`（statements／branches／functions／lines=`64.19／63.80／70.33／69.04`）、controlled production build、secret scan、readiness truth 與 local release verifier 均通過。
- Boundary：Preview 必須使用 PayUni `sandbox`、Production 必須使用 `production`；本次未呼叫 PayUni、未操作 staging／Production、未付款／退款／寄信，也未保存任何 environment value。PayUni account、order／provider reference binding、reconciliation、external provider 與人工 acceptance 仍 pending；`PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`、`releaseDecision=NO_GO` 維持不變，Goal remains active。

## REL-20260821-CI-PAYUNI-BOUNDARY — CI explicit PayUni binding gate（2026-08-21）

- Release candidate：`10c7726`；`.github/workflows/ci.yml` 新增 `PayUni deployment environment binding contract` step，讓每次 push／pull request 的 CI 明確執行 `src/lib/env.test.ts`。
- Verification：本機 CI-equivalent env test `33/33`、`npm audit --omit=dev --audit-level=high` 為 `0 vulnerabilities`、lint、TypeScript、strict-index、Node TAP `763/763`、combined coverage `3075 passed／1 skipped`（`64.19／63.80／70.33／69.04`）、controlled production build、secret scan、readiness truth、local release verifier 與 `git diff --check` 均通過。
- Boundary：這是 CI contract wiring 與本機 evidence，尚未宣稱 GitHub Actions remote run PASS；沒有 staging、PayUni、外部 provider、Production、付款、退款、寄信或人工 acceptance side effect。`PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`、`releaseDecision=NO_GO` 維持不變，Goal remains active。
