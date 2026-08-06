# WP-161 Next Dev Startup Candidate Semantic Triage

## Scope

本包只讀 WP-160 已接受 receipt 的 7 個 module-evaluation candidates，並限制在
候選所在檔案與必要的同檔 symbol span。沒有執行、import、transpile 或 evaluate
產品 module；沒有啟動 Next server、build、Browser、network、DB、PayUni、staging
或 Production。

## Deterministic result

來源 receipt：`.ai-team/reports/wp161-next-dev-startup-candidate-triage.json`

| 欄位 | 結果 |
|---|---|
| status | `WP161_STARTUP_CANDIDATE_TRIAGE_VERIFIED` |
| conclusion | `WP161_STATIC_TRIAGE_REMAINS_INDETERMINATE` |
| WP-160 candidates | `7/7`，每個恰好一個 terminal disposition |
| safe fallback | `3` |
| confirmed high-confidence startup risk | `0` |
| requires runtime evidence | `4` |
| ownership unsafe | `0` |
| root-cause inference | `false` |

三個環境值讀取候選可由明確 comparison／boolean fallback 靜態排除；三個直接
傳入外部 wrapper 的候選與 `withSentryConfig` wrapper 本身仍需要 runtime／dependency
evidence，因此不能宣稱沒有啟動風險，也不能把 WP-158 的 non-zero exit 當成 root cause。

## Quality／ownership evidence

- Semantic matrix：`14/14 PASS`；WP-160 candidate lineage 與 count guard PASS。
- Scoped ESLint：`PASS`。
- TypeScript `--noEmit`：`PASS`。
- `git diff --check`：`PASS`。
- Strict receipt readback：`PASS`。
- Current truth：`71.5/100`，WP-160 acceptance：`ACCEPT`。
- Protected digests 前後一致；`UNKNOWN=0`、`MIXED_HUNKS=0`；staged index empty。
- Receipt 只保存相對路徑、symbol、span、phase、reachability、normalized guard、digest 與分類；沒有 source snippet、raw AST、URL、環境值、Token 或 Cookie。

## Side effects／score impact

所有 build、server、process spawn（產品流程）、Browser、network、database、provider、
PayUni、staging、Production、deployment、product module evaluation、dotenv contents
read 與 raw output persist 均為 `0`／`false`。

- CAT06：`7.0 → 7.0`
- CAT09：`6.5 → 6.5`
- Total：`71.5 → 71.5`
- `NEXT_DEV_STARTUP_CANDIDATE_TRIAGE=VERIFIED`
- `NEXT_DEV_STARTUP_RISK=STATIC_TRIAGE_REMAINS_INDETERMINATE`
- real server readiness、hermetic build、Browser 與 Production readiness 仍 `NOT_VERIFIED`

## AGY Fast

兩次唯讀 QA 均為 `FIRST_OUTPUT_TIMEOUT`，最終標記 `TOOL_BLOCKED`。
沒有可採用的 structured QA evidence；此結果不取代 deterministic evidence。

## Sol High acceptance

`ACCEPT`。Sol High 確認 7 個 candidate 各有且只有一個 disposition，receipt／ownership／
deterministic gates 完整，且沒有把需要 runtime evidence 的候選外推成 WP-158 或產品
root cause。WP-86 維持 authoritative `ACCEPT`，不得重跑。

## Rollback／停止條件

Rollback 僅移除 WP-161 runner、test、receipt 與本 evidence；不得修改 WP-160、WP-86、
產品 source、Next config、package／lockfile、Prisma 或其他 dirty paths。若 candidate
digest、ownership、lineage 或 count 不一致，必須保存 `WP161_EXACT_NO_GO_OWNERSHIP_OR_LINEAGE_UNSAFE`
並停止；不得重跑 WP-86、WP-158、WP-159 或任何已消耗的 build／server attempt。
