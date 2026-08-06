# WP-178 — Linked-CWD Preview env-run remediation

## 結果

`WP178_LINKED_CWD_ENV_RUN_EXACT_NO_GO`

已精確使用 linked workspace cwd、team scope `a25814740s-projects`、project `celebrate-deal-staging` 與 Preview target。一次 non-sensitive upsert 成功後，唯一一次 `vercel env run` 仍以 exit 1 結束，sanitized child records 為 0；依 attempt budget沒有重跑，一次 sensitive rollback 成功。

## Deterministic evidence

- linked project／project ID／org ID／scope：精確匹配
- offline CLI resolution contract：PASS
- 相同 value-free Node child 本機執行：exit 0、records 1、exactSandbox=true
- live Vercel env-run：exit 1、records 0
- Preview sensitive rollback：成功
- 原 deployment：`dpl_9KrvwFKkGKAVEzVZdm5Tc9iiQqCg`，仍為 `preview / READY`
- redeploy、alias、DB、PayUni、Production：0
- staged index：空

這證明 WP-177 的未連結 temp cwd 不是唯一根因；child 本身的語法與 value-free schema正常，剩餘阻塞位於 Vercel env-run broker／environment retrieval，在沒有安全的 error-family receipt 前不得再推論。

## 安全與分數

未讀取 `.env*`、其他環境值或 raw CLI output；未保存 secret、token、cookie、連線字串或 response body。CAT04 維持 `6.0/10`，總分維持 `72.0/100`，沒有宣稱 runtime lineage、Sandbox reconciliation 或 Production readiness 通過。

## AGY Fast QA

兩次唯讀 QA 都在取得 structured output 前遭 wrapper 的 empty-line parameter binding error 阻擋，保存為 `TOOL_BLOCKED`。AGY 未執行外部操作，也未被當成 PASS 或用來取代 deterministic evidence。
