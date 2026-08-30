# WP-136 — Repository `.next` ownership and temp-isolation audit

## 結果

Sol High 計畫的單一範圍已完成，結果為 `SAFE_TEMP_EXCLUSION_PROVEN`。本包只驗證 repository `.next` 的 metadata ownership 與未來 OS temp mirror 的排除契約，不判斷 generated artifact 內容正確性，也不把它當成 build、typegen、Browser 或 deployment 證據。

## 唯讀邊界與 ownership

- repository `.next` 視為 `IGNORED_GENERATED_PRESERVE_ONLY`；未刪除、移動、清理、重建或讀取其檔案內容。
- Git tracked path count 為 `0`；`.gitignore` 的 `/.next/` 規則有效。
- WP-135、其他既有 dirty files 與既有 receipts 全部維持 `PRESERVE_ONLY`。
- 本包唯一新增 owned paths 為 runner、self-test、sanitized receipt 與本 evidence 文件。
- staged index 在 audit 前後均為空。

## Metadata-only receipt

Receipt：`.ai-team/reports/wp136-next-temp-isolation-audit-receipt.json`

| 項目 | Audit 前 | Audit 後 |
|---|---:|---:|
| files | 4,080 | 4,080 |
| directory entries | 437 | 437 |
| total bytes | 5,094,105,619 | 5,094,105,619 |
| reparse points | 6 | 6 |
| metadata digest | `5836335c253c19db0b4b63218f0a8684119f88592a6cf0832f05bce725896ace` | 相同 |
| content reads under `.next` | 0 | 0 |

Metadata digest 前後一致。Receipt 只保存 aggregate counts、digest 與 sanitized flags，不保存 generated raw path 清單或內容。

## Temp-isolation contract

- root `.next` 在 source-selection 遞迴前被 prune：`rootPrunedBeforeRecursion=true`。
- 實際 root probe：selected `53`、excluded `1`、selected `.next` paths `0`、entered `.next` `false`。
- in-memory synthetic probe 覆蓋 root／nested `.next`、Windows 大小寫與 separator；selected `.next` paths `0`。
- `.next-safe`、`.next-old` 等相似名稱不會被誤排除。
- reparse point 不會被跟隨。
- generated-content read guard attempted reads `0`。

## Deterministic validation

- `node --test scripts/wp136-next-temp-isolation-auditor.test.mjs`：7 passed、0 failed、0 skipped。
- `npx eslint scripts/wp136-next-temp-isolation-auditor.mjs scripts/wp136-next-temp-isolation-auditor.test.mjs`：PASS。
- `node scripts/wp136-next-temp-isolation-auditor.mjs`：`SAFE_TEMP_EXCLUSION_PROVEN`。
- audit 前後 dirty inventory fingerprint 與 count 不變（309 → 309）。
- protected package/config/lockfile digests 前後不變。
- AGY Fast 兩次均為 `FIRST_OUTPUT_TIMEOUT`／`TOOL_BLOCKED`；沒有 stdout、沒有 raw output receipt，未取代 deterministic evidence。
- server、Browser、typegen、DB、PayUni、staging、deployment、Production 與 dotenv 操作均為 `0`。

## Score 與 Gate 影響

| 類別／Gate | 前 | 後 | 變動 |
|---|---:|---:|---:|
| CAT06 UX／RWD／無障礙 | 7.0 | 7.0 | 0 |
| CAT09 部署／Release／回滾 | 6.5 | 6.5 | 0 |
| 總分 | 71.0 | 71.0 | 0 |

G1=`CLOSED`、G2=`LOCAL_REHEARSAL_PASS`；G3–G6 仍 `NOT_VERIFIED`。`SANDBOX_READY=false`、`PRODUCTION_READY=false`。本包只解除 `.next` temp-isolation ownership blocker，不能外推為 fresh typegen、build、Browser 或 production readiness。

## 風險與 rollback

主要風險是其他 Next process 在 audit 期間改動 `.next` metadata、Windows path normalization 漏判，或未來 runner bypass exclusion contract。本次 digest 與 counts 前後一致，未觀察到變動。

Rollback 不涉及既有檔案：只需移除尚未 checkpoint 的 WP-136 新 owned artifacts；不得刪除或重建 repository `.next`，不得回復 WP-135 或其他 dirty changes。

## Stop boundary

後續 lineage/typegen 工作仍必須使用 WP-136 的 root-prune contract；不得進入或讀取 repository `.next`。若發現 metadata 變動、tracked `.next`、reparse 無法分類、需要修改既有 runner／source／config，或需要 server／Browser／typegen／dotenv／external 操作，必須 fail closed 並另立工作包。

## AI_TEAM_HANDOFF

```yaml
work_package: WP-136
role: Terra
status: COMPLETE_PENDING_SOL_ACCEPTANCE
classification: SAFE_TEMP_EXCLUSION_PROVEN
sol_plan: READY_FOR_TERRA_PREFLIGHT
ownership: NEW_OWNED_ONLY
repository_next: IGNORED_GENERATED_PRESERVE_ONLY
git_tracked_next_paths: 0
metadata_before_after_equal: true
generated_content_reads: 0
root_prune_before_recursion: true
selected_next_paths: 0
reparse_points_followed: false
dirty_inventory_unchanged: true
staged_index: EMPTY
server_runs: 0
browser_runs: 0
typegen_attempts: 0
database_operations: 0
external_operations: 0
score_delta: 0
CAT06: 7.0
CAT09: 6.5
total: 71.0
agy_fast:
  attempts: 2
  status: TOOL_BLOCKED
  reason: FIRST_OUTPUT_TIMEOUT
  deterministic_replacement: false
next_action: SOL_HIGH_ACCEPTANCE
```
