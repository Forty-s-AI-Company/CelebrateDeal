# WP-134 Post-WP131 sanitized Next server startup-error mapping

## 結果

`BLOCKED_OR_FAILED`／`UNKNOWN_FAIL_CLOSED`。依計畫只啟動一次隔離的 loopback Next dev server；child 於 `/login` readiness 前以 exit code `1` 結束，但 bounded in-memory output 經遮罩後仍無法可靠辨識 error family、phase、generated/source path 或 symbol。因此沒有提出可修改的產品候選，也沒有重試或執行 Browser。

## Ownership 與安全邊界

- 新增範圍僅 WP-134 runner、self-test、receipt 與本 evidence；既有 application、Next／Playwright config、package／lockfile、WP-126／129／133 receipts 全部唯讀。
- preflight：6/6 required input present、staged index empty、dirty inventory `235` 前後一致、selected source/config digests 前後一致。
- fresh OS temp mirror 排除 `.env*`、`.next`、`.ai-team`、`node_modules`、database／certificate／secret-like paths；mirror inspect missing `0`、forbidden copied `0`、junction PASS、module resolution `4/4`、ephemeral loopback port PASS。
- child stdout/stderr 僅在記憶體中 bounded；receipt 只有分類、fingerprint、路徑／symbol 欄位（本次均不足），`rawOutputPersisted=false`。
- 沒有 Browser、資料庫、network、PayUni、staging、deployment、DNS 或 Production side effect。

## Diagnostic receipt

Receipt：`.ai-team/reports/wp134-next-startup-error-mapping-receipt.json`。

| 欄位 | 結果 |
| --- | --- |
| next server launches | `1/1`，未 retry |
| readiness | `/login` 未就緒，process exit `1` |
| normalized error family | `UNKNOWN` |
| phase | `SERVER_STARTUP` |
| generated/source path | 未辨識 |
| symbol | 未辨識 |
| ownership | `UNKNOWN`，無法證明 hunk overlap |
| historical comparison | 已讀 WP-126／129／133 的 sanitized classifications/fingerprints；本次 fingerprint 不足以建立穩定 source mapping |
| process cleanup | PASS |
| runner mirror cleanup | FAIL；之後以已驗證的精確 WP-134 temp path 手動清除，`manualTempCleanup=PASS` |

因為 exact mapping 與 cleanup 的 runner invariant 不完整，Sol 的 acceptance 必須維持 `PLAN_REMEDIATION`／不得加分；manual cleanup 不會把 runner 原始失敗改寫成 PASS。

## Deterministic evidence

- `node --test scripts/wp134-next-startup-error-mapper.test.mjs`：5 passed／0 failed／0 skipped。
- syntax check、scoped ESLint、`npm run typecheck` 與 `git diff --check`：PASS。
- sanitization、generated-to-source mapping、error-family／phase classification、unknown／untracked ownership fail-closed self-tests：PASS。
- AGY Fast：第一次 wrapper 因 prompt 關鍵字誤判 `LOGIN_REQUIRED`，未採用；第二次等價唯讀審查回 `OK/PASSED`。總計 2 次，AGY 沒有取代 deterministic evidence。

## Score／Gate boundary

- CAT06：`7.0 → 7.0`。
- CAT09：`6.5 → 6.5`。
- Total：`71.0 → 71.0`。
- G1 `CLOSED`、G2 `LOCAL_REHEARSAL_PASS`、G3–G6 `NOT_VERIFIED`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

本包只是 evidence-blocker diagnosis；不代表 build、Browser、可販售或 production readiness。

## Stop／rollback

本包已消耗唯一 launch budget；不得再啟動 Next、重試 Browser 或修改 application／Next config／package／lockfile。若放棄此包，僅移除 WP-134 新增 runner、self-test、receipt、evidence；不得碰 WP-126／128／129／131／133 或其他 dirty paths。下一步需 Sol 重新規劃同一根因的更精確診斷，或由 owner 提供可安全分離的 path／hunk 授權。

## AI_TEAM_HANDOFF

```text
WORK_PACKAGE=WP-134
ROLE=TERRA
STATUS=BLOCKED_OR_FAILED
CLASSIFICATION=UNKNOWN_FAIL_CLOSED
SOL_VERDICT=PENDING_ACCEPTANCE
NEXT_SERVER_LAUNCHES=1/1
BROWSER_RUNS=0
ERROR_FAMILY=UNKNOWN
SOURCE_MAPPING=NOT_ESTABLISHED
OWNERSHIP=UNKNOWN
DETERMINISTIC=5 self-tests; ESLint PASS; typecheck PASS; diff-check PASS
AGY=NOT_RUN_YET
SCORE_DELTA=0
AGY=PASS_AFTER_2_ATTEMPTS (first wrapper false-positive LOGIN_REQUIRED)
NEXT_ACTION=SOL_ACCEPTANCE_OR_PLAN_REMEDIATION
```
