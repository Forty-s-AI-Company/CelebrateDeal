# SEC-2026-08-08-83｜Production dependency audit 與 nanoid transitive fix

記錄時間：2026-08-08（Asia/Taipei）  
結果：`COMPLETE_LOCAL_SECURITY_P1_NO_SCORE_CHANGE`

## 發現與修正

最新 production dependency audit 初始結果為 1 個 high finding：

- transitive package：`nanoid`
- 受影響版本範圍：`<3.3.17`
- advisory：`GHSA-2v37-7h3g-55p8`
- 來源鏈：`@tailwindcss/postcss@4.3.2 → postcss@8.5.23 → nanoid@3.3.16`
- 初始 audit exit code：`1`

已在 root `package.json` 增加最小範圍 override `nanoid: ^3.3.17`，更新 lockfile 並同步本機 dependency tree；實際解析版本為 `nanoid@3.3.18`。本次 lockfile 同步也反映既有 working-tree 的 `js-yaml` override，沒有回退或覆蓋使用者既有變更。

修正後重新執行 production dependency audit：high=0、critical=0、total vulnerabilities=0，exit code `0`。

## Deterministic verification

- `src/lib/monitoring.test.ts`、`src/app/api/health/route.test.ts`、`scripts/secret-scan.test.ts`：3 files、22/22 PASS。
- `npx tsc --noEmit`：PASS。
- `npm run build`：PASS；Next production build 產生 static pages 89/89。
- `npm run lint`：exit code 0、0 errors；另保留既有無關腳本的 2 個 unused-vars warnings，沒有把 warning 誤報成零 warning。
- `git -c core.autocrlf=false diff --check -- package.json package-lock.json`：PASS。

## 分數與未完成邊界

Canonical readiness truth 維持 **73.5**：CAT04=6.0、CAT10=4.5，`current_goal_score_change=0`，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。dependency 修復是必要安全閉環，不等同 CAT04 的全新 authorized staging／PayUni Sandbox transaction、provider receipt／refund reconciliation，也不等同 CAT10 真人 owner 簽核與 external monitoring delivery／ack／recovery evidence。

本輪沒有 Production、正式資料庫、正式付款／退款、寄信、PayUni Sandbox、staging、deployment、push 或 merge；沒有讀取或輸出 secrets、正式客戶資料或付款資料。沒有重試 FIN-08AA、WP-196 或 WP-197。

沒有降低 coverage threshold、source inventory、exclude、skip、assertion 或資料驗證強度；coverage gate 的既有 source-inventory 結果不被本輪安全修復掩蓋，也不阻擋這次功能與安全驗證。

## 回滾與下一步

回滾範圍限於 `package.json` 的 nanoid override、對應 `package-lock.json` dependency resolution，以及本輪 evidence／control-plane metadata；沒有 production migration 或外部 side effect。下一步應優先取得全新的、已授權 CAT04 staging／PayUni Sandbox evidence，或由真人完成 CAT10 merchant／support／finance／privacy-legal／release owner acceptance 與 external monitoring evidence；Goal 維持 `IN_PROGRESS`。
