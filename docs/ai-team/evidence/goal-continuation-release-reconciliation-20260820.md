# Goal continuation release reconciliation（2026-08-20）

本 checkpoint 只記錄 current worktree 的本機、disposable 與 synthetic 驗證；沒有操作 staging、Production、正式付款／退款／寄信、外部 provider 或 deployment。工作樹原本已有大量 tracked 與 untracked 變更，本輪沒有使用 `reset`、`clean`、`stash`、`restore` 或其他丟棄變更的 Git 操作。

## 本輪修正

- 移除 `scripts/g7-email-operations-browser-qa.mjs` 中已被新版 `main` 取代且沒有引用的 legacy runner，避免 dead code 與 coverage inventory 噪音。
- 移除 `scripts/wp130-cloudflare-stream-webhook-contract-runner.mjs` 未使用的 `relative`／`sep` imports。
- 將 G7-55 static contract 從已不存在的舊 generated-spec token `EmailDelivery` 對齊到現行 runner 實際使用的 `emailDelivery` accessor；沒有降低 receipt、migration、privacy、CSRF、cleanup 或 screenshot assertions。
- 修正 `scripts/run-combined-coverage.mjs` 的 coverage merge：Vitest 的 `scripts/` 0-count placeholder 會與 Node TAP 的實際 production-script coverage 重複計入；現在只移除這些 placeholder，再合併 Node TAP 結果。沒有改變 coverage threshold，也沒有排除任何 production script。
- 新增 `scripts/staging-backup-restore-disposable-drill.mjs` 與對應 contract tests：以兩個 `postgres:16-alpine`、tmpfs、loopback-only port 與 explicit child environment 演練 58 個 migration 的 schema/data logical backup、isolated restore、migration status、aggregate／extension snapshot compare 與 cleanup。raw dump 只留在記憶體，receipt 只保存 byte count、SHA-256 與固定結果分類。
- 修正 restore target 的 `public` schema declaration conflict，並在 restore 前建立 migration 所需的 `pgcrypto`／`pg_trgm` extensions；沒有把 local disposable drill 誤標成實際 staging 或 platform-level restore。

## Current verification

| Gate | Current result |
|---|---|
| ESLint | `PASS`，0 errors、0 warnings |
| TypeScript typecheck | `PASS` |
| Strict index typecheck | `PASS` |
| Secret scan | `PASS`，`secret_scan_passed` |
| Release-readiness contract | `1 file / 4 passed / 0 failed / 0 skipped` |
| G7-55 and WP130 targeted tests | `1 file / 10 passed / 0 failed / 0 skipped` |
| Combined coverage merge contract | `1 file / 6 passed / 0 failed / 0 skipped` |
| Node TAP contract suite | `762 passed / 0 failed / 0 skipped` |
| Combined coverage gate | `PASS`，`403 files passed / 1 skipped`、`3073 passed / 1 skipped` |
| Disposable staging-style backup／restore drill | `PASS`，58 migrations；schema/data backup、restore、aggregate／extension compare、source／target／temp cleanup 全部 `PASS` |
| Controlled production build | `PASS`，isolated no-dotenv mirror、synthetic allowlisted environment、mirror cleanup `PASS` |
| Local release verifier | `verified`；只確認 artifact／source contract，application environment availability 全部為 `false` |
| Local rollback rehearsal | `rollback-rehearsed`；candidate activation failure 後 recovered checksum 等於 previous checksum |

## Coverage result（如實保留）

`node scripts/run-combined-coverage.mjs` 的功能、contract 與 threshold gate 通過：

- Vitest：`403 files passed / 1 skipped`、`3073 passed / 1 skipped`
- Node TAP：`762 passed / 0 failed / 0 skipped`
- Disposable PostgreSQL migration／backup／restore cleanup：migration count `58`；source container、target container、temp root 均 `PASS`
- Combined coverage：statements `64.18%`、branches `63.80%`、functions `70.33%`、lines `69.04%`
- Existing threshold：`63 / 57 / 60 / 65`
- 判定：`PASS`；本輪沒有降低 threshold、加入 skip 或使用 exclude 掩蓋缺口。

修正前的 `47.87% / 52.34% / 56.50% / 64.40%` 是重複計入 Vitest 0-count script placeholder 的失真結果，已由 current-tree run supersede。修正後仍完整計入 `scripts/` inventory；尚未執行的 CLI／browser orchestration path 仍會如實反映為未覆蓋，沒有被隱藏。新增 disposable runner 後，coverage 仍高於既定門檻，沒有以 skip 或 exclude 掩蓋新增程式。

## Disposable backup／restore receipt

`.ai-team/reports/staging-backup-restore-disposable-receipt.json` 經 `--verify-receipt` 驗證為 `PASS`。本 receipt 僅代表本機一次性 PostgreSQL 演練：`loopbackOnly=true`、`noPersistentVolume=true`、`productionOperations=false`，且 `sourceEnvContentsRead=false`、`rawDumpPersisted=false`、`rawOutputPersisted=false`。它不等同 Supabase platform restore、實際 staging restore、PITR 或 Production disaster-recovery proof。

## 2026-08-21 G7-55 Browser rerun

G7-55 runner 在本機 disposable PostgreSQL、isolated no-dotenv mirror、loopback server 與 external-network-denied environment 下重新執行。修正 keyboard focus／Tab 流程與 failed／live reminder filter 操作，並將 expired CSRF assertion 限定到 `#email-delivery-operations-form`。Fresh receipt `docs/ai-team/evidence/g7-55-email-operations-browser-qa-4d9c1276b5dc9719.json` 為 `PASS`：5/5 Browser、0 failed、0 skipped、Axe critical／serious `0`、desktop／mobile RWD、keyboard、filters、CSRF、tenant isolation、container／server／temp cleanup 全部 `PASS`。這仍是 local Browser evidence，Resend 真實送達與 staging／Production 服務未執行。

## 2026-08-21 RT-01-D2 live-chat disposable refresh

現有 RT-01-D2 receipt 首次驗證時如實被拒絕，原因是 receipt 於 2026-08-16 產生、只記錄 55 個 migrations，而 current tree 已有 58 個；receipt digest 本身一致。使用相同 loopback／tmpfs／synthetic-only runner 重新執行後，`.ai-team/reports/rt01-live-chat-disposable-receipt.json` 通過 `--verify-receipt` 的 canonical absolute-path 驗證：58 migrations、validate／deploy／status／migration state／live-chat DB suite 全部 `PASS`，DB suite `1/1`、0 failed、0 skipped，container／temp cleanup `PASS`。safety flags 保持 `sourceEnvContentsRead=false`、`rawOutputPersisted=false`、`loopbackOnly=true`、`noPersistentVolume=true`、`syntheticFixturesOnly=true`、`productionSideEffects=false`。這只補強 local disposable evidence，不代表實際 staging／Production recovery、外部服務或人工 acceptance。

## Release 判定

本 checkpoint 不能把專案提升為正式販售 `GO`。目前仍保留：

- PayUni Sandbox reconciliation 尚未取得 current controlled provider evidence；
- Cloudflare、Resend、Sentry、PostHog、durable rate limit 的 production-level external evidence 未完成；
- 實際 staging migration／backup／restore／rollback 與正式環境 identity 尚未完成；本輪新增的 disposable drill 不能取代它；
- 法務、退款政策、客服 escalation 與 owner acceptance 尚未完成；
- local release candidate 已於 commit `b70539f` 凍結；`git status --short`、staged index 與 `git diff HEAD` 均為 clean。這只代表 source tree checkpoint 完成，不代表 Production readiness。

## Local release-candidate freeze

Current-tree secret scan 為 `secret_scan_passed`，`git diff --check` 為 `PASS`。在檢查 107 tracked modifications 與 287 untracked files 的明確 inventory、檔名安全界線與總大小約 18.21 MiB 後，將 394 個可見 source／test／migration／evidence 檔案以 local commit `b70539f` 凍結。commit 後 `git status --short`、staged index 與 `git diff HEAD` 均為 clean；沒有 push、merge、Production deploy 或正式服務操作。Git 背景 auto-gc 仍因既有 `refs/codex/turn-diffs/...` bad object／Windows long-path refs 回報 housekeeping error，未影響 commit，也沒有刪除或修改未知 refs。

因此目前最多維持 local／Sandbox／不收真實款項的封閉試用狀態，Goal 維持 `active`。
