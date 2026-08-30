# WP-123 Local Observability Incident Rehearsal

## 結果

`LOCAL_DETERMINISTIC_PASS`；AGY Fast 兩次 timeout 為 `TOOL_BLOCKED`；Sol High `ACCEPT`。WP-116 accepted fixed-schema observability 是唯讀基礎；本包沒有修改 production observability、payment、refund、webhook 或 reconciliation code。

- 9 個 deterministic timeline scenarios：healthy、reconciliation mismatch、duplicate delivery、matched/unmatched recovery、out-of-order、missing field、invalid status、unknown event。
- 15 個 self-tests 通過。
- mismatch 會產生固定 incident code、severity 與 derived correlation；同一事件 fingerprint 只觸發一次，duplicate 被 suppression。
- 相符 recovery 轉為 recovered；不相符或太早 recovery 轉為 recovery_rejected，open incident 不被誤關閉。
- malformed、缺欄位、未知 event、額外敏感-like payload fail closed；receipt 不保存 raw event payload。
- `externalTelemetry=PENDING`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。
- ESLint、TypeScript、`git diff --check`、staged index empty 通過；沒有 network、DB、provider、staging 或 Production side effect。

## Score 邊界

CAT08 由 `6.5/10` 調整為 `7.0/10`，總分由 `70.0` 調整為 `70.5`；Sol High 判定 incident lifecycle evidence 足以支援。Current snapshot 已依 ownership review 更新，WP-119/WP-122/WP-123 receipts 保持 immutable。這包不證明外部 telemetry delivery、alert/pager、Production monitoring 或 G3–G6。

## Ownership／rollback

所有修改是 WP-123 新檔：contract、fixtures、evaluator、self-tests、receipt 與本 evidence。WP-116 artifacts、產品程式、schema、migration、current snapshot 與其他 dirty paths PRESERVE_ONLY。Rollback 僅移除 WP-123 owned 檔案。

```yaml
AI_TEAM_HANDOFF:
  work_package: WP-123
  role: Terra executor
  status: LOCAL_DETERMINISTIC_PASS
  score_before: { CAT08: 6.5, total: 70.0 }
  score_after: { CAT08: 7.0, total: 70.5 }
  score_delta: 0.5
  sol_acceptance: ACCEPT
  scenarios: 9
  self_tests: 15
  semantics: { healthy: PASS, mismatch_detection: PASS, duplicate_suppression: PASS, matched_recovery: PASS, unmatched_recovery: PASS, malformed_fail_closed: PASS, redaction: PASS }
  external_telemetry: PENDING
  labels: { SANDBOX_READY: false, PRODUCTION_READY: false }
  external_side_effects: false
  deferred:
    - external telemetry and alert delivery
    - WP-118 external staging/provider reconciliation
    - CAT01/CAT06/CAT09 gap work
    - G3-G6 verification
```
