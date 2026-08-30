# WP-148 Local Reliability／Incident Diagnostic Evidence Contract

## 結果

WP-148 已完成單一 LOCAL observability evidence contract。這不是 telemetry delivery，也沒有修改產品 runtime logging、WP-116／WP-123／WP-147 artifacts 或任何既有 dirty path。

- classification：`LOCAL_RELIABILITY_DIAGNOSTIC_CONTRACT_VERIFIED`
- state：`LOCAL_VERIFIED`
- CAT08：7.0 → 7.5（Sol High `ACCEPT` 後已套用）；總分 71.0 → 71.5（已套用）
- authoritative rubric rule：`CAT08_LOCAL_STRUCTURED_LOG_AND_FAILURE_MATRIX`
- rubric source class：`LOCAL_PRIMARY`
- external telemetry：`NOT_COLLECTED`
- `SANDBOX_READY=false`、`PRODUCTION_READY=false`
- Sol acceptance receipt：`.ai-team/reports/wp148-sol-acceptance.json`

## Value gate

`docs/launch/readiness-reconciliation-2026-07-30.md` 的 CAT-08 驗收要求 public/authenticated/billing budgets、timeout/retry/duplicate/late-event fail-closed matrix 與 sanitized structured-log assertions；同一份 backlog 將「Reliability/performance local evidence」列為 `LOCAL`，並明確說明可補 CAT-08 真實失敗模式。WP-148 以此 rule 建立受限 evidence contract；receiver delivery receipt 仍保留為外部缺口。

## 覆蓋範圍

Contract 僅接受 sanitized synthetic envelope，並驗證：

- public、authenticated、billing budget 維度存在於 fail-closed matrix。
- timeout、retry、duplicate、late-event 都必須 fail closed。
- structured-log assertions 只允許 sanitized fields。
- environment、ownership、correlation key 都進入 protected fingerprint，避免跨環境誤合併。
- diagnostic completeness 缺失時保留 `ROOT_CAUSE_UNKNOWN`，不從 marker 或錯誤碼臆測 source/config/dependency 根因。
- 外部 telemetry 未收集時固定輸出 `EXTERNAL_NOT_COLLECTED`，不得轉成 end-to-end observed。
- token、cookie、URL、raw body、stack、source snippet、raw output 等 key/value 直接拒絕，且不保存被拒內容。

既有 evidence 只以 read-only digest lineage 引用：WP-116、WP-123、WP-147。WP-147 的 `BUILD/UNKNOWN_BUILD_ERROR` 維持 `ROOT_CAUSE_UNKNOWN`。

## Deterministic evidence

- `node --test scripts/wp148-local-reliability-contract.test.mjs`：6 passed / 0 failed / 0 skipped。
- contract runner：4 個 synthetic scenarios，3 個 unique fingerprints，1 個 duplicate suppression。
- canonical digest repeated run：穩定。
- forbidden-field rejection：PASS。
- environment／ownership isolation：PASS。
- side effects：browser、database、deployment、network、PayUni、Production、staging、telemetry 全部 0。
- receipt：`.ai-team/reports/wp148-local-reliability-contract.json`，只含 sanitized metadata、digest lineage、coverage、狀態與 side-effect counters。

## Quality／ownership

- WP-148 新增檔案：
  - `scripts/wp148-local-reliability-contract.mjs`
  - `scripts/wp148-local-reliability-contract.test.mjs`
  - `.ai-team/reports/wp148-local-reliability-contract.json`
  - `.ai-team/reports/wp148-agy-fast-qa.json`
  - `.ai-team/reports/wp148-sol-acceptance.json`
  - `docs/ai-team/evidence/wp-148-local-reliability-contract.md`
- scoped ESLint：PASS（0 errors、0 warnings）。
- `npm run typecheck`：PASS。
- `git diff --check`：PASS。
- staged index：EMPTY。
- WP-116／WP-123／WP-147 receipts、產品 source/config/package/lockfile 與既有 dirty changes：`PRESERVE_ONLY`。

## Acceptance boundary

即使本地 contract 通過，也不能宣稱 receiver telemetry delivery、alert/pager、sandbox reconciliation、部署、production rollback 或正式商業上線。Sol High 已給出 `ACCEPT`，因此 CAT08 7.0 → 7.5 與總分 71.0 → 71.5 已寫入 current scoreboard；external telemetry、production measurements 與 G3–G6 仍未驗證。

## AI_TEAM_HANDOFF

```yaml
role: TERRA
work_package: WP-148
status: ACCEPTED_AND_CHECKPOINTED
workflow_mode: PRELAUNCH_DEV
execution_performed: true
scope: LOCAL_RELIABILITY_INCIDENT_DIAGNOSTIC_EVIDENCE_CONTRACT
value_gate: PROVEN_BY_AUTHORITATIVE_CAT08_LOCAL_RULE
deterministic:
  runner: PASS
  tests: "6/6"
  eslint: PASS
  typecheck: PASS
  diff_check: PASS
  staged_index: EMPTY
ownership:
  new_owned_paths_only: true
  preserve_only_inputs: true
  unknown: 0
  mixed_hunks: 0
side_effects:
  network: 0
  database: 0
  browser: 0
  telemetry: 0
  payuni: 0
  staging: 0
  deployment: 0
  production: 0
external_telemetry: NOT_COLLECTED
score_before: { CAT08: 7.0, total: 71.0 }
candidate_score_after: { CAT08: 7.5, total: 71.5 }
score_applied: true
sol_acceptance: ACCEPT
next_actor: CODEX_DESKTOP_MAIN_COORDINATOR
agy_fast_budget: 2
acceptance_options: [ACCEPT, CONTINUE_CURRENT_WP, PLAN_REMEDIATION]
prohibited: [RAW_LOG, ENV, NETWORK, DATABASE, PAYUNI, STAGING, PRODUCTION, RUNTIME_LOGGING_MODIFICATION]
```
