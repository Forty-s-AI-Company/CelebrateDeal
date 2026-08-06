# WP-146 PayUni Sandbox／staging 離線證據對帳

本包只讀取既有 sanitized WP-117、WP-118、WP-132 receipts，未呼叫 PayUni、staging、DB、network、Browser、server、build 或 deployment。輸出 `.ai-team/reports/wp146-payuni-sandbox-reconciliation.json` 只保存 evidence digest、環境 identity boolean、reservation count、contradiction count 與分數影響；不保存 order、provider reference、URL、raw response、SQL、cookie、token 或 secret。

## Result

結果為 `EXACT_NO_GO_EXTERNAL_REFRESH_REQUIRED`：目前 evidence 顯示 synthetic pending reservation 為 `0`；WP-132 post-deploy page 也明確拒絕在沒有 pending reservation 時操作。現有資料沒有 authoritative current deployment version marker，也沒有 proven non-Production DB identity marker，因此不得把 WP-117 provider receipt 與 staging local state 串成完整 CAT04 reconciliation。

WP-117 雖有一次 PayUni Sandbox provider query，且 provider 已 refunded，但 local observation 仍 `partially_refunded`、reconciled=false；WP-118 是 LOCAL contract evidence，live Sandbox/staging proof=false。上述缺口不能由離線文件推測補足。

## Acceptance / score impact

- WP-146 deterministic self-tests：5/5 PASS。
- receipt allowlist、digest lineage、side-effects=0、staged empty：PASS。
- CAT04 維持 `6.0/10`；總分維持 `71/100`。
- G3–G6、`SANDBOX_READY`、`PRODUCTION_READY` 不變。
- 若要取得 CAT04 新證據，需要新的明確 external refresh／staging data authorization；本包不得自動查詢或寫入。

## Rollback / stop

Rollback 僅刪除 WP-146 自有 runner、test、receipt、evidence；不得修改 WP-117／118／132、WP-144／145 或任何既有 dirty。若 current marker、唯一 pending reservation、lineage 或 canonical scoring rule 缺失，維持 exact no-go。

## AI_TEAM_HANDOFF

```text
work_package=WP-146
owner=Terra
planner=Sol High
verdict=pending Sol acceptance
classification=EXACT_NO_GO_EXTERNAL_REFRESH_REQUIRED
CAT04=6.0 (unchanged)
sideEffects=0
next=Sol acceptance; external refresh requires separate authorization/WP
```
