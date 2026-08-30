# WP-160 — Next dev startup dependency／risk contract

## 範圍

本包只以 TypeScript AST 與相對 module-resolution 做 bounded、唯讀 startup graph 分析；不 import、evaluate 或執行產品 module，不啟動 build／server／Browser，不連 network／DB／PayUni／staging／Production，也不讀取 `.env*`、secret、token、cookie、URL 或 raw logs。WP-158／159、Next config、instrumentation、app entrypoints、Prisma、`.next` 與既有 dirty paths 均為 `PRESERVE_ONLY`。

## Authoritative 結果

來源 receipt：`.ai-team/reports/wp160-next-dev-startup-dependency-contract.json`

| 欄位 | 結果 |
|---|---|
| status | `WP160_NEXT_DEV_STARTUP_RISK_CONTRACT_VERIFIED` |
| classification | `STATIC_ANALYSIS_INDETERMINATE` |
| bounded entrypoints | `19` |
| normalized findings | `12` |
| module-evaluation candidates | `7` |
| root-cause inference | `false` |
| WP-158 relation | 只保留 `NONZERO_EXIT_BEFORE_READY` boundary |

分析找到多個 module-evaluation candidate（包括 Next config wrapper 與 eager environment access），不是單一可安全歸因的 blocker，因此 fail-closed 分類為 `STATIC_ANALYSIS_INDETERMINATE`；沒有把它們宣稱為 WP-158 的產品 root cause。request-time dependency 另行標記，沒有誤算成 startup blocker。

## Deterministic／quality evidence

- Synthetic AST／dependency matrix：`15/15 PASS`。
- scoped ESLint：`PASS`。
- TypeScript `--noEmit`：`PASS`。
- `git diff --check`：`PASS`。
- strict receipt readback：`PASS`。
- bounded graph、cycle／duplicate fingerprint、type-only import、dynamic import、client-only module 與 generated artifact guard 均驗證。
- finding 僅保存 relative path、symbol、bounded span、phase、confidence 與 source digest；沒有 source snippet 或 raw AST。
- protected digests 前後一致；`UNKNOWN=0`、`MIXED_HUNKS=0`；staged index empty。
- 所有 build／server／process spawn／Browser／network／DB／provider／staging／Production side effects 均為 `0`。
- CAT06：`7.0 → 7.0`；CAT09：`6.5 → 6.5`；total：`71.5 → 71.5`。

## AGY Fast

兩次唯讀 QA 均為 `FIRST_OUTPUT_TIMEOUT`，最終標記 `TOOL_BLOCKED`。
AGY 沒有產生可採用的 structured QA evidence；此結果不取代 deterministic evidence，
也不表示產品通過或失敗。

## Sol High acceptance

`ACCEPT`。Sol High 確認 bounded static-analysis 目標、receipt integrity、ownership、
deterministic evidence 與 side-effect boundaries 均成立。`STATIC_ANALYSIS_INDETERMINATE`
僅表示存在多個 startup candidates／dynamic boundaries；沒有將任何 candidate 外推為
WP-158 的 root cause。WP-86 已有 authoritative `ACCEPT`，不得重跑。

## Gate／後續

本包只證明 static startup inventory 已建立，但目前仍有多候選／動態邊界，未證明 server readiness、build、Browser 或 Production。下一包若要修正，必須由新的 Sol plan 指定單一可安全分離的 blocker；不得以本 receipt 直接修改產品 source 或重跑 WP-158。

Rollback 僅移除 WP-160 runner、test、receipt 與本 evidence；不修改任何既有 source、config、package、lockfile、`.next` 或歷史 receipt。
