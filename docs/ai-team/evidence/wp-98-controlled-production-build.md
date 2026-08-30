# WP-98 — CAT09 受控零外部環境 Production Build Gate

日期：2026-07-30  
類別：CAT-09 部署、環境、Release 與回滾  
狀態：`ACCEPTED_NO_SCORE`

## Ownership remediation

原計畫需要修改 `package.json`，但 preflight 證明該檔案已有使用者的 PayUni 與 release scripts 變更，且位於同一個 scripts object hunk。Sol 因 `MIXED_HUNKS=0` 給出 `PLAN_REMEDIATION`，將 `package.json` 改為 preserve-only。

最終唯一 owned product paths：

- `config/build-env.controlled.json`
- `scripts/build/controlled-production-build.mjs`
- `scripts/build/controlled-production-build.test.mjs`

`package.json` pre/post SHA-256 一致；staged index 維持空。

## 已驗證的安全能力

- child process 僅接收受控 synthetic config、Node runtime 的最小 OS allowlist、`NODE_ENV=production`、關閉 Next telemetry 與 Sentry upload 的明確開關；不繼承宿主 application environment。
- controlled config 只允許固定 key set、synthetic `build.invalid` URL 與 loopback port 1 database URL；production-like 或疑似敏感 value 在 build 前拒絕。
- OS temporary mirror 以檔名規則排除 `.env`、`.env.*`、`.git`、`node_modules`、`.next` 與 coverage；mirror 在 finally 清除。
- Next child stdout/stderr 僅保留在記憶體，receipt 僅保存固定 failure category、exit code、key names 與 cleanup result。

## Deterministic evidence

- `node --test scripts/build/controlled-production-build.test.mjs`：4 passed。
- scoped ESLint：PASS。
- `npx tsc --noEmit`：PASS。
- `git diff --check`：PASS；staged index 為空。
- controlled no-env temp mirror 的 `next build --webpack`：`FAIL`、exit 1、`SOURCE_QUALITY_FAILURE`。
- receipt 顯示 `inheritedApplicationEnvironment=false`、`mirrorCleanup=PASS`；沒有保存 config values、child output 或 `.env` 內容。
- AGY Fast：`OK`，確認隔離、排除 env files、診斷抑制與 cleanup；它沒有把 build failure 當成通過。
- Sol High：`ACCEPT`、`NO_SCORE_ACCEPT`。

## Score boundary 與 deferred

CAT-09 維持 `6.5`。受控 runner 成功證明 release build 的隔離與可觀測 failure boundary，但 production build 沒有成功，因此不得宣稱 fresh controlled build Gate 關閉，也不得將 CAT-09 調至 7.0。

`SOURCE_QUALITY_FAILURE` 必須另開一個具有獨立 source ownership 的工作包診斷與修復；不在 WP-98 擴張 scope。
