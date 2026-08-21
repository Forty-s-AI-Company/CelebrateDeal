# REL-20260821-CONTROLLED-PRODUCTION-BUILD

日期：2026-08-21（Asia/Taipei）  
Source RC：`c308363`
Documentation checkpoint：`c308363`
Environment：`local disposable no-env mirror`  
Result：`PASS`  
sanitized：`true`  
productionOperations：`0`

## Verification

以 current source RC 執行：

```text
node scripts/build/controlled-production-build.mjs
controlled production build: PASS
exitCode=0
failureCategory=NOT_APPLICABLE
preflightExitCode=0
preflightFailureCategory=NOT_APPLICABLE
nextBuildExitCode=0
inheritedApplicationEnvironment=false
mirrorCleanup=PASS
```

Runner 只載入 `config/build-env.controlled.json` 的 allowlisted synthetic values，建立排除 `.env*`、`.git`、`node_modules`、`.next` 與 `coverage` 的隔離鏡像；先在鏡像內以 `preflight.ts --production` 執行 production-mode preflight，成功後才執行 `next build --webpack`。child process 不繼承 application environment，build 完成後鏡像已清理。preflight 與 Next build 都是本次 source checkpoint 的實際執行結果。

## Boundary

- 這是 local／disposable controlled build evidence，不是 GitHub Actions current-RC run，也不是 actual staging 或 Production build。
- 沒有讀取、輸出或傳送 `.env*`、密碼、Token、Cookie、正式 Secret、正式客戶或付款資料。
- 沒有 staging、Production、外部 provider、PayUni、付款、退款、寄信、部署或 workflow dispatch side effect。
- controlled synthetic production preflight 已通過，但實際 Production preflight 仍需在受控環境驗證 `CRON_SECRET`、獨立 `CSRF_SECRET`、`LIVE_CHAT_INGRESS_SECRET`、durable rate limit 與其他正式 binding；本 receipt 不把 synthetic keys 升格為正式設定已完成。
