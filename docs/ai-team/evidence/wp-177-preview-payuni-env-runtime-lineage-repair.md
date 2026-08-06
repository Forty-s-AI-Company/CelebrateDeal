# WP-177 — Preview PAYUNI_ENV runtime lineage repair

## 結果

`WP177_RUNTIME_PROBE_PROCESS_EXACT_NO_GO`

Preview `PAYUNI_ENV=sandbox` 的 non-sensitive upsert 執行一次後，唯一一次乾淨 OS-temp runtime probe 在產生 sanitized child record 前以 exit 1 結束。依 Sol 核准的 attempt budget，沒有重跑。

## 已驗證事實

- linked project：`celebrate-deal-staging`
- environment：Preview
- 原 deployment：`dpl_9KrvwFKkGKAVEzVZdm5Tc9iiQqCg`
- 原 deployment 仍為 `preview / READY`
- staging alias 仍指向原 deployment
- non-sensitive upsert：1 次
- runtime probe：1 次，exit 1，sanitized child records 0
- sensitive rollback：1 次，成功
- redeploy、health probe、alias mutation：0 次
- DB 與 PayUni：0 次
- Production：0 次
- staged index：空

CLI help 確認 `vercel env run` 支援 `--project`。由於 probe 在 workspace 外的未連結 temp cwd 執行，而目標 project 位於 team scope，下一個 remediation 應只驗證 team-scope-aware broker invocation；這是目前最合理但尚未經新 live attempt 證實的根因假設。

## 安全與 rollback

未讀取 `.env*`，未保存 raw CLI output、環境值、secret、token、cookie 或 response body。Preview `PAYUNI_ENV` 已回復原本 sensitive 型態；部署與 alias 未變更。OS temp 目錄為空，但 Codex host policy 阻擋刪除，沒有敏感資料寫入其中。

## Score impact

CAT04 維持 `6.0/10`，總分維持 `72.0/100`。WP-177 沒有解除 runtime lineage blocker，也沒有宣稱 Sandbox reconciliation 成功。

## AGY Fast QA

兩次唯讀 QA 都在取得 structured output 前遭 wrapper 的 empty-line parameter binding error 阻擋，保存為 `TOOL_BLOCKED`。AGY 沒有執行外部操作，也沒有被當成 PASS 或用來取代 deterministic evidence。
