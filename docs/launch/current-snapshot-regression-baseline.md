# Current Snapshot Regression Baseline — WP-04

日期：2026-07-27
最終 Run ID：`20260727155807-8d6acbd8`

本次基準在系統暫存目錄建立工作樹快照，排除 `.git`、所有 `.env*`、依賴與衍生目錄；測試子程序只接收固定 synthetic 值。來源 `.env*` 的內容沒有被讀取、複製或輸出。

## 隔離環境與安全證據

- Safety receipt：[environment-safety.json](../../.ai-team/reports/wp-04-regression-baseline-20260727155807-8d6acbd8/environment-safety.json)
- Source manifest：[source-manifest.json](../../.ai-team/reports/wp-04-regression-baseline-20260727155807-8d6acbd8/source-manifest.json)
- Sanitized receipts：[regression-summary.sanitized.json](../../.ai-team/reports/wp-04-regression-baseline-20260727155807-8d6acbd8/regression-summary.sanitized.json)
- Raw local logs：`.ai-team/logs/wp-04/20260727155807-8d6acbd8/`
- DB gate：`127.0.0.1:54329`、allowlisted `celebratedeal_ci`、本次 `wp04_20260727155807_8d6acbd8` schema；完整 URL 與憑證未寫入 evidence。
- `package-lock.json` 前後 SHA-256 相同；快照與 run-scoped schema 已安全移除。
- `SENTRY_DISABLE_AUTO_UPLOAD=true`、Sentry telemetry 關閉與 `NEXT_TELEMETRY_DISABLED=1` 都只在隔離測試子程序生效；最終 build log 沒有 Next 或 Sentry telemetry 訊息。

## 真實回歸矩陣

| 項目 | 實際命令／依據 | Exit code | 分類 | 結果 |
|---|---|---:|---|---|
| dependency install | `npm ci` | 0 | PASS | 586 packages；既有 lockfile 未改。 |
| secret scan | `npm run secret:scan` | 0 | PASS | 隔離 snapshot 掃描通過。 |
| Prisma validate/generate | `npx prisma validate`／`generate` | 0／0 | PASS | schema 有效並生成 client。 |
| Prisma migration/status | `npx prisma migrate deploy`／`status` | 0／0 | PASS | 11 migrations 僅套用於 disposable schema，status 為 up to date。 |
| lint | `npm run lint` | 0 | PASS | 真實執行通過。 |
| typecheck | `npm run typecheck` | 0 | PASS | 真實執行通過。 |
| strict-index | `npm run typecheck:strict-index` | 0 | PASS | 真實執行通過。 |
| unit tests／coverage | `npm run test:coverage` | 0 | PASS | 116 test files、923 tests 通過；All files lines 64.95%。 |
| build | `npm run build` | 0 | PASS | preflight、Prisma generate、Next production build 均完成；無 telemetry log。 |
| integration tests | 專案沒有獨立、可安全執行的 integration command | — | NOT_APPLICABLE | 不能把 923 個 unit tests 誤稱成獨立 integration suite。 |
| Playwright discovery | `npx playwright test --list` | 0 | PASS | 在 `accessibility`、`performance`、`smoke` 三個 spec 發現 39 tests。 |
| 產品 E2E journey | 不在 WP-04 執行範圍 | — | NOT_APPLICABLE | discovery 不等同實跑產品 E2E；保留給 WP-08。 |
| release-check | 上列隔離 gates 的彙整 | 0 | MOCKED_PASS | 僅證明無正式 env 的 local regression baseline，不等同正式上線核准。 |

本包沒有 `FAIL`、`BLOCKED_BY_TEST_INFRA` 或 `MANUAL_BLOCKED` 項目。

## QA 與限制

Gemini Fast 在早期 P1003 receipt 上已完成一次 sanitized-receipt completeness QA；最終 run 則由主 Codex 逐份回查 receipt、raw log、schema 清理與 telemetry log。Gemini Deep 不需要且未使用。

這份基準不代表 Supabase ACL、PayUni sandbox、觀測平台、正式 Browser journey、screen-reader、DNS／法務／營運等人工或外部 Gate 已通過。
