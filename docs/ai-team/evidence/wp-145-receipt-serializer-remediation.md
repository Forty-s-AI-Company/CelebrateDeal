# WP-145 receipt serializer／validator remediation

WP-145 只修復 WP-144 新增 runner 的 receipt guard，沒有執行或重跑任何 build。WP-144 的 authoritative sanitized receipt 保持原狀：`SANITIZED_RECEIPT_WRITE_FAILURE_EXACT_NO_GO`、`buildAttempts=1`，不可回推 build diagnostic 或 marker。

## Deterministic evidence

- synthetic serializer／validator／安全邊界測試：8 passed。
- `symbol`／`span` normalization：合法 bounded `line:column` 通過，畸形 span 拒絕。
- atomic temp write 與 committed readback validation：PASS。
- `rawOutputPersisted=false`、`rawOutputExposed=false` 強制維持。
- scoped ESLint、`npm run typecheck`、`git diff --check`：PASS。
- WP-144 receipt readback validation：PASS，未改寫；`buildAttempts` 仍為 1。
- staged index：empty；沒有 build、server、Browser、DB、network、PayUni、staging、deployment 或 Production side effect。

AGY Fast report：`.ai-team/reports/wp145-agy-fast-qa.json`。兩次無 structured stdout，標記 `TOOL_BLOCKED`，不取代 deterministic evidence。

## Acceptance and score impact

本包只使 receipt serializer／validator infrastructure gate 達到 `REMEDIATED_READY`；WP-144 仍是 `EXACT_NO_GO`，hermetic build verification 仍 `NOT_PASSED`。CAT09 維持 `6.5/10`，總分維持 `71/100`。任何未來 build 都必須由新的 Sol plan 與新 WP 授權，不能視為 WP-144 retry。

## Rollback／stop

Rollback 僅撤銷 WP-145 對 WP-144 runner／test 的最小 patch，並刪除 WP-145 自有 evidence/report；不得修改 WP-144 receipt、WP-143、既有 dirty 或 Goal state。若 ownership、serializer contract、staged 或 readback 任一失敗，立即停止。

## AI_TEAM_HANDOFF

```text
work_package=WP-145
owner=Terra
planner=Sol High
verdict=pending Sol acceptance
scope=WP-144 receipt serializer/validator only
buildRuns=0
wp144BuildAttempts=1 (immutable)
scoreImpact=none
next=Sol High acceptance; future build requires a new WP
```
