# WP-159 — Next launch prerequisite／artifact lineage contract

## 目的與邊界

本包只做 LOCAL、唯讀的 launch prerequisite classification。它不執行 `next build`、Next server、Browser、資料庫、network、PayUni、staging 或 Production，也不讀取 `.env*`、secret、token、cookie 或 raw logs。既有 WP-144／145／147 build artifacts、WP-155／156／158 server artifacts、`.next`、產品 source/config、package／lockfile 與 dirty paths 均為 `PRESERVE_ONLY`。

## Authoritative 結果

來源 receipt：`.ai-team/reports/wp159-next-launch-prerequisite-contract.json`

| 欄位 | 結果 |
|---|---|
| status | `WP159_NEXT_LAUNCH_PREREQUISITES_VERIFIED` |
| classification | `NEXT_LAUNCH_PREREQUISITES_VERIFIED` |
| command family | `NEXT_DEV` |
| command source | `WP158_STATIC_RUNNER_SOURCE` |
| runtime mirror | `OS_TEMP_MIRROR` |
| host／port policy | `LOOPBACK_ONLY`／`SYNTHETIC_UNIQUE` |
| accepted build | `false`（WP-144／WP-147 都是 `EXACT_NO_GO`） |
| existing `.next` artifact set | metadata complete，但仍 `PRESERVE_ONLY`，未因存在而信任為 accepted build |
| current/runtime input lineage | 相同 digest；Next package `16.2.11` 與 installed version 相符 |
| build／server／Browser | 全部 `0` |
| network／DB／provider／staging／Production | 全部 `0` |
| raw output／`.env*` read | `false`／`false` |

這個結果只表示目前 WP-158 採用的 `NEXT_DEV` + OS temp mirror 前置條件可由 sanitized source/config/package/lockfile lineage 判定；不表示 server readiness、Browser、hermetic build 或 Production readiness 已通過。WP-144／WP-147 的 failed／unknown build receipts 沒有被轉換成 build success。

## Deterministic 與 quality evidence

- WP-159 scenario／contract tests：`12/12 PASS`。
- scoped ESLint：`PASS`。
- TypeScript `--noEmit`：`PASS`。
- `git diff --check`：`PASS`。
- strict receipt readback：`PASS`。
- preserve-only digests：前後一致。
- staged index：empty。
- `UNKNOWN=0`、`MIXED_HUNKS=0`。
- CAT06：`7.0 → 7.0`；CAT09：`6.5 → 6.5`；total：`71.5 → 71.5`。

實作期間的第一次 self-preflight 只發現 runner 將自身新增檔誤列為 collision；該次在任何 current-state classification 前 fail closed，沒有外部或產品 side effect。修正同一個 WP-159-owned preflight guard 後，才保存上方 authoritative receipt；沒有重跑 build/server，也沒有擴大 scope。

## AGY Fast

兩次均 `FIRST_OUTPUT_TIMEOUT`，因此狀態為 `TOOL_BLOCKED`；沒有 structured QA receipt，未取代 deterministic evidence，也未宣稱 QA PASS。

## Sol High acceptance

`ACCEPT`（2026-08-03）。Sol 確認 `NEXT_DEV` 靜態前置條件可 checkpoint；此 ACCEPT 不代表 runtime、hermetic build、Browser 或 Production readiness，也不產生任何分數上調。

## Gate／分數影響

- CAT06 不變：`7.0`。
- CAT09 不變：`6.5`。
- 總分不變：`71.5/100`。
- `NEXT_LAUNCH_PREREQUISITES=VERIFIED`。
- Hermetic build、server readiness、Browser evidence、Production readiness：仍 `NOT_VERIFIED`。

## 風險與 rollback

主要風險是把 `.next` 檔案存在誤當成可信 build，或把 `NEXT_DEV` 錯套 `NEXT_START` 規則；contract 已將 command family、accepted build receipt、artifact ownership 與 lineage 分開驗證。Rollback 僅移除 WP-159 的 runner、test、receipt 與本 evidence；不得修改既有 receipts、`.next`、source/config、package／lockfile 或使用 Git 丟棄指令。
