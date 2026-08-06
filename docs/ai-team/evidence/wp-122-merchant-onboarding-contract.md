# WP-122 Merchant Onboarding Local Readiness Contract

## Scope 與結果

`LOCAL_DETERMINISTIC_PASS`；Sol High `ACCEPT`。WP-110 的八個 onboarding stage 與六個角色被轉為新的 machine-readable contract；validator 只讀 local JSON，不連網、不讀資料庫、不操作商家、PayUni、staging 或 Production。

Receipt：`.ai-team/reports/wp122-merchant-onboarding-receipt.json`

- 8/8 stage、6/6 role 結構驗證通過。
- 14 個 self-tests 通過：缺 stage、owner、evidence、rollback、escalation、placeholder、未知 status、人工／法務／客服 pending、偽造 readiness label、敏感值與 deterministic ordering 均 fail closed。
- `localContract=PASS`；`manualRehearsal=PENDING`、`legalApproval=PENDING`、`supportReadiness=PENDING`；`overallReadiness=NOT_READY`。
- `SANDBOX_READY=false`、`PRODUCTION_READY=false`；未建立真實商家、帳號、邀請、付款或外部 side effect。
- ESLint、TypeScript、`git diff --check`、staged index empty 均通過。
- Current snapshot 已依 Sol ownership review 更新為 70.0／CAT10 3.5；WP-119 checkpoint receipt 保持 69.5／CAT10 3.0，不被改寫。current truth validator 與 test 以 WP-122 delta 0.5 重算通過。

## Value 與分數邊界

CAT10 由 `3.0/10` 調整為 `3.5/10`，總分由 `69.5` 調整為 `70.0`；Sol High 判定這是比 WP-110 純文件更強的 fresh executable local evidence。人工 onboarding rehearsal、法務政策、客服／財務 owner acceptance、DNS、Production release 仍未驗證，故不得把 CAT10 或整體標為可販售／Production ready。

## Ownership／rollback

所有修改均為 WP-122 新檔：contract、synthetic fixture、validator、self-tests、本 evidence 與 receipt。WP-110 既有 runbook／receipt、產品程式、schema、migration 與 dirty worktree 均 PRESERVE_ONLY。Rollback 僅移除 WP-122 新增檔案；沒有外部或資料庫 rollback。

```yaml
AI_TEAM_HANDOFF:
  work_package: WP-122
  role: Terra executor
  status: LOCAL_DETERMINISTIC_PASS
  local_contract: PASS
  manual_rehearsal: PENDING
  legal_approval: PENDING
  support_readiness: PENDING
  overall_readiness: NOT_READY
  score_before: { CAT10: 3.0, total: 69.5 }
  score_after: { CAT10: 3.5, total: 70.0 }
  score_delta: 0.5
  sol_acceptance: ACCEPT
  deterministic: { stages: 8, roles: 6, self_tests: 14, eslint: PASS, typecheck: PASS, diff_check: PASS, staged_index: EMPTY }
  external_side_effects: false
  labels: { SANDBOX_READY: false, PRODUCTION_READY: false }
  deferred:
    - manual merchant onboarding rehearsal
    - legal/privacy/refund policy approval
    - support and finance owner acceptance
    - WP-118 external staging/provider reconciliation
    - G3-G6 verification
```
