# WP-144 hermetic Next webpack build

本工作包只允許一次本機、OS temporary mirror 內的 `next build --webpack`。WP-143 的 sanitized receipt contract 是唯讀依賴；WP-143 artifacts、既有 dirty paths、產品 source、Next config、package/lockfile、repository `.next` 均為 `PRESERVE_ONLY`。

## Scope and safety

- 僅使用已存在的本機 Next binary；不安裝依賴、不使用 `npx`、不連網、不啟動 server／Browser／DB、不呼叫 PayUni、不部署、不操作 Production。
- 複製 mirror 前以 path-only 規則排除 `.env*`、資料庫／私密檔案、`.git`、`.next`、`.ai-team`、`.agents` 與暫存／build output；禁止 symlink/reparse escape。
- stdout/stderr 只以 streaming sanitizer 讀取，receipt 僅保存 phase、error family/code、相對路徑、symbol/span、marker、digest 與 ownership metadata；raw output 永不保存或輸出。
- build budget 僅 1 次；timeout、spawn failure、non-zero 或 receipt/cleanup 失敗均 fail closed，不 retry。

## Acceptance evidence

實際 receipt：`.ai-team/reports/wp144-hermetic-build-receipt.json`。本次唯一 attempt 在 receipt serializer guard 發生錯誤，結果已以 `SANITIZED_RECEIPT_WRITE_FAILURE_EXACT_NO_GO` fail-closed 保存；buildAttempts=1、raw output 未保存／未暴露、temp cleanup PASS、workspace `.next` 未觸碰。由於診斷與 marker 結果不可安全保存，不得推論 build 成功或失敗原因，也不得 retry。

AGY Fast：`.ai-team/reports/wp144-agy-fast-qa.json`。兩次 bounded read-only attempt 均無 structured stdout，標記 `TOOL_BLOCKED`；AGY 不取代 deterministic evidence。

CAT09 維持 `6.5/10`，總分維持 `71/100`。只有新的 Sol High acceptance（且不得重跑本包已消耗的 build budget）才可決定後續範圍。

Deterministic gates：WP-143 digest lineage、staged index empty、ownership unknown/mixed hunks 為 0、mirror 在 OS temp、`.env*` copied=0、argv 精確、buildAttempts ≤ 1、sanitized receipt allowlist/round-trip、workspace `.next` untouched、temp cleanup PASS。

## Rollback and stop

Rollback 僅刪除 WP-144 自有 receipt／evidence／runner／test；不得觸碰既有檔案。若 preflight、ownership、receipt schema、cleanup 或唯一 build budget 任一失敗，保存遮罩化結果後停止，不開始下一個 WP。

## AI_TEAM_HANDOFF

```text
work_package=WP-144
owner=Terra
planner=Sol High
scope=one local hermetic next build --webpack with sanitized receipt
external_side_effects=0
production=0
retry_budget=0
acceptance=Sol High only: ACCEPT | CONTINUE_CURRENT_WP | PLAN_REMEDIATION
```
