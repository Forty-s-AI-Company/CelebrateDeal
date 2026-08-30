# WP-124 — Hermetic No-dotenv Production Build Rehearsal

## 結果

本包為 `LOCAL_ONLY`，Sol High 計畫目標是移除 CAT09 的 fresh no-dotenv build 證據缺口。新建 runner 在 OS temp mirror 內執行，沒有讀取、複製、hash、輸出、改名或移動任何 `.env*`，沒有安裝依賴、連網、接觸資料庫／provider、部署或操作 Production。

Deterministic preflight 通過；fresh `next build --webpack` 仍以 exit code `1` 結束，沒有產生可驗證的 `BUILD_ID` 或 required manifests。因此 WP-124 **FAIL／PLAN_REMEDIATION**，CAT09 維持 `6.5/10`，不能宣稱 fresh production build、deployment 或 rollback Gate 通過。

## Sanitized evidence

- `.ai-team/reports/wp124-no-dotenv-build-receipt.json`
  - preflight `exitCode=0`
  - build `exitCode=1`，`failureClass=COMPILE_OR_TYPECHECK`
  - `dotenv_content_read=false`
  - `dependency_install=false`、`network_requested=false`
  - `database_contacted=false`、`provider_contacted=false`、`deployment_attempted=false`
  - mirror 排除 5 個 dotenv path、4 個 database files；沒有 forbidden files 留在 mirror
  - `cleanup.pass=true`
  - dirty entries `204 -> 204`、`workspace_preserved=true`、staged index 未修改
  - receipt 只保存 exit code、時間、分類訊號與 output digest；沒有保存 raw build log 或環境值
- `.ai-team/reports/wp124-agy-fast-qa.json`
  - AGY Fast 兩次 timeout，狀態 `TOOL_BLOCKED`
  - 不取代 deterministic build 結果

## Ownership／rollback

所有產品檔案、Next 設定、package script、lockfile、Prisma schema／migration 與既有 dirty entries 均 `PRESERVE_ONLY`。本包新增 contract、runner、self-test、receipt 與本 evidence。Rollback 僅移除 WP-124 新增檔案，並確認 runner 精確建立的 OS temp mirror 已清理；不得 reset、clean、stash、restore、checkout 或回復其他變更。

## Score／Gate impact

| 項目 | 執行前 | 執行後 |
|---|---:|---:|
| CAT09 | 6.5 | 6.5（無分數變動） |
| 總分 | 70.5 | 70.5 |

G1 `CLOSED`、G2 `LOCAL_REHEARSAL_PASS`、G3–G6 `NOT_VERIFIED`、`SANDBOX_READY=false`、`PRODUCTION_READY=false` 均維持不變。

## 停止／後續

停止於 deterministic build non-zero；不得為通過而修改 application／Next config、package scripts、lockfile、dotenv 或放寬 artifact assertion。下一個 remediation 必須先由 Sol High 規劃，並釐清 current build worker 的可重現 compile/type boundary；若需要新依賴、網路、真實設定或修改 preserve-only 檔案，立即 `DEFERRED_WAITING_AUTHORIZATION`。

```yaml
AI_TEAM_HANDOFF:
  work_package: WP-124
  role: Terra executor
  disposition: PLAN_REMEDIATION
  sol_acceptance: PENDING
  deterministic:
    preflight: PASS
    fresh_production_build: FAIL_EXIT_1
    artifacts: FAIL_MISSING
    cleanup: PASS
    workspace_preserved: PASS
    staged_index: EMPTY
  agy_fast: TOOL_BLOCKED_AFTER_2_TIMEOUTS
  score_impact:
    CAT09: 6.5 -> 6.5
    total: 70.5 -> 70.5
  gates:
    G1: CLOSED
    G2: LOCAL_REHEARSAL_PASS
    G3: NOT_VERIFIED
    G4: NOT_VERIFIED
    G5: NOT_VERIFIED
    G6: NOT_VERIFIED
  rollback: remove only WP-124 owned files and exact temp mirror
  deferred:
    - build-worker compile remediation pending Sol plan
    - deployment and Production rollback
    - WP-118 external PayUni reconciliation authorization
```
