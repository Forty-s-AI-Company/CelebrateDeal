# REL-20260821-LOCAL-BROWSER-RELEASE-GATE

日期：2026-08-21（Asia/Taipei）  
Source RC：`6e3eddb`  
Environment：`non-production loopback`  
Result：`BLOCKED`  
sanitized：`true`  
productionOperations：`0`

## Verification

以 current source RC 執行：

```text
npm run e2e -- --workers=1
result: 137 passed、1 failed；138 tests；約 10.1 分鐘
```

唯一失敗是 `tests/e2e/accessibility.spec.ts:302` 的 `static authenticated owner routes have no blocking axe violations`。owner MFA helper 的完整 browser flow 在 30 秒內沒有完成 URL commit，畫面仍停留在 `/settings/security?updated=mfa_started`，submit button 維持 pending。這不能列為 Browser gate PASS。

同一份 accessibility spec 的有序重跑結果為：

```text
npx playwright test tests/e2e/accessibility.spec.ts --workers=1
result: 7 passed、1 failed
```

為確認 transport 狀態，曾在單次診斷重跑中只記錄 action response 的 HTTP status、path 與既有 redirect header，不讀取 response body、cookie、MFA 資料或任何 credential。兩次 MFA Server Action 都回應 `303`，redirect header 分別為：

```text
/settings/security?updated=mfa_started;push
/settings/security?updated=mfa_enabled;push
```

瀏覽器仍未完成對應 URL commit。這與既有的 Next 16 Server Action redirect transport residual 一致；目前沒有證據顯示 MFA assertion、資料庫 transaction、cookie 寫入或 `FormSubmitButton` 可用安全的放寬方式修正。診斷程式已移除，工作樹保持 clean。

孤立執行 owner static case 曾得到 `1 passed`，但這不能抵銷有序 accessibility spec 與完整 Browser suite 的失敗。現況應記為 order-sensitive local Browser blocker，不能以 focused PASS 取代完整 gate。

## Boundary

- 只使用 loopback PostgreSQL、Chromium 與 isolated E2E fixtures。
- 沒有 staging、Production、Cloudflare、Resend、Sentry、PostHog、durable rate limit、PayUni、付款、退款、寄信或 deployment side effect。
- 沒有降低 URL assertion、增加 retry、使用 reload、加入 skip 或改寫成只驗證 response header。
- `ENGINEERING_READY=true`、`PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false` 與 `releaseDecision=NO_GO` 維持不變。

## Next safe action

保留目前 Browser blocker 的真實 evidence；不重試同一個完整 suite 死路。若要修復，需另開明確 scope 的 Next 16 Server Action navigation transport work package，先建立最小可重現測試，再由 source owner 審核任何 client navigation 或 action transport 改動。staging lineage、migration、recovery、rollback 與外部 provider 工作仍需先取得核准的 non-Production authorization，不得因 local Browser focused case 通過而提前執行或升級 readiness。
