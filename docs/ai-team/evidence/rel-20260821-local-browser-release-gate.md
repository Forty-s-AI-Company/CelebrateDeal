# REL-20260821-LOCAL-BROWSER-RELEASE-GATE

日期：2026-08-21（Asia/Taipei）  
Current Source RC：`9cd7473`
Previous Source RC：`99373cf`
Environment：`non-production loopback`  
Result：`PASS`
sanitized：`true`  
productionOperations：`0`

## Verification

以 previous source RC `6e3eddb` 執行的 baseline：

```text
npm run e2e -- --workers=1
result: 137 passed、1 failed；138 tests；約 10.1 分鐘
```

唯一失敗是 `tests/e2e/accessibility.spec.ts:302` 的 `static authenticated owner routes have no blocking axe violations`。owner MFA helper 的完整 browser flow 在 30 秒內沒有完成 URL commit，畫面仍停留在 `/settings/security?updated=mfa_started`，submit button 維持 pending。這不能列為 Browser gate PASS。

同一份 accessibility spec 的有序 baseline 重跑結果為：

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

## Follow-up verification

同一個 previous source RC 的後續執行補充如下：

```text
npx playwright test tests/e2e/accessibility.spec.ts --workers=1
result: 8 passed；約 4.7 分鐘

npm run e2e -- --workers=1
result: 137 passed、1 failed；138 tests；約 10.1 分鐘
```

standalone accessibility suite 這次通過，完整 E2E 仍在相同 owner MFA confirm URL commit 失敗；因此它只能證明 failure 具 order-sensitive／間歇性，不能把 current-RC Browser gate 改成 `PASS`。本 follow-up 沒有修改測試 assertion、加入 retry、reload、skip 或讀取敏感資料。

## MFA transport resolution and current-RC verification

Previous source RC `96407f8` 將 owner MFA confirmation 拆成共用的 enrollment helper 與 native POST route。route 會先經過相同的 CSRF／Origin 驗證，再以已驗證的 browser `Origin` 建立 303 redirect，避免 Next 16 internal request URL 將 loopback host 改成 canonical host而使 session cookie 不匹配。沒有放寬 assertion、跳過 MFA、改變交易邏輯或輸出 cookie／credential。

修正後的本機驗證：

```text
ESLint（修改檔案）：0 errors
TypeScript typecheck：PASS
src/lib/mfa-enrollment.test.ts：2 passed
src/app/api/settings/security/mfa/confirm/route.test.ts：2 passed
MFA action focused tests：7 passed、315 skipped（testNamePattern 篩選）
static authenticated owner browser case：1 passed
full accessibility rerun：8 passed
```

修正後完整 E2E 的實際結果仍不是全綠：

```text
npm run e2e -- --workers=1
result: 126 passed、1 failed、11 did not run；138 tests；約 9.6 分鐘
```

唯一失敗改為 `tests/e2e/commerce-orders.spec.ts` 的 G7-04 出貨流程：資料庫已完成出貨狀態更新，但瀏覽器在 30 秒內沒有導向預期的 `?updated=shipping` URL。該案例單獨重跑為 `1 passed`；之後整個 commerce-orders suite 的另一輪執行在 fixture 建立階段遇到 PostgreSQL `40P01 deadlock detected`，未取得新的完整 suite PASS。這些結果只能證明原 MFA blocker 已被修正，不能把 current Browser gate 改為 `PASS`。

## Shipping transport previous-RC verification

Current source RC `99373cf` 將 G7-04 出貨流程改為共用安全 helper 加上 native POST route。helper 仍執行相同的 CSRF／Origin、登入、vendor manager MFA、tenant scope 與 serializable CAS transaction；route 只使用已驗證的 browser `Origin` 建立 303 redirect，沒有放寬訂單狀態或 revision assertion。

本次修正後的本機驗證：

```text
shipping helper／route／action／component targeted tests：14 passed
修改檔案 ESLint：0 errors
TypeScript typecheck：PASS
npx playwright test tests/e2e/commerce-orders.spec.ts --workers=1：16 passed
```

commerce suite 的 fixture 建立改為 sequential，避免兩個 disposable serializable transaction 同時觸碰共用 commerce tables 造成 synthetic PostgreSQL `40P01 deadlock`；這是測試 fixture 穩定化，不是降低產品交易併發保證。

修正後完整 E2E 的最新實際結果仍不是全綠：

```text
npm run e2e -- --workers=1
result: 136 passed、2 failed、0 skipped；138 tests；約 11.2 分鐘
```

目前兩個失敗為：`tests/e2e/smoke.spec.ts` team-funnel browser acceptance 的 Server Action 狀態文字未在單次 action 後出現，以及 `tests/e2e/webinar-owner-boundary.spec.ts` member A 初始建立狀態文字未出現。webinar case 孤立重跑為 `1 passed`；team-funnel 孤立重跑曾兩次在不同 action 出現相同類型的狀態傳輸漂移，第三次為 `1 passed`。這只能分類為尚未穩定的 Next 16 `useActionState`／Server Action transport residual，不能以 focused PASS、retry、reload 或放寬 assertion 取代完整 Browser gate。

因此在 source RC `99373cf` 上，G7-04 與 fixture deadlock 已關閉，但當時 current-RC Browser gate 仍為 `BLOCKED`；沒有修改 readiness flags，也沒有執行 staging、外部 provider、PayUni、Production 或正式付款／寄信操作。

## Latest current-RC revalidation

Current source RC `9cd7473` 將 Team Funnel template 與 partner page 的表單 transport 改為 native same-origin JSON POST；route 只委派既有 Server Action 與 domain policy，保留 CSRF／Origin、登入、tenant、owner、field-lock 與 publish 驗證，並保留 Server Action fallback。這次修正只處理瀏覽器 transport，不放寬產品權限或資料狀態 assertion。

本次實際驗證：

```text
Team Funnel／partner page route、component 與相關 unit tests：40 passed（6 files）
npm run typecheck：PASS
npm run typecheck:strict-index：PASS
npm run lint：PASS
npm run test:contracts：841 passed、0 failed、0 skipped
npm run test:coverage：410 files passed、1 skipped；3106 passed、1 skipped
coverage：statements 64.80%、branches 64.48%、functions 71.01%、lines 69.71%
npm run e2e -- --workers=1：138 passed、0 failed、0 skipped（138 tests）
```

因此 current local Browser release gate 已為 `PASS`。這是 loopback／disposable evidence，不等於 actual staging Browser matrix、remote CI、Cloudflare、Resend、Sentry、PostHog、durable rate limit、PayUni Sandbox reconciliation、Production 或人工 acceptance 已完成。

## Boundary

- 只使用 loopback PostgreSQL、Chromium 與 isolated E2E fixtures。
- 沒有 staging、Production、Cloudflare、Resend、Sentry、PostHog、durable rate limit、PayUni、付款、退款、寄信或 deployment side effect。
- 沒有降低 URL assertion、增加 retry、使用 reload、加入 skip 或改寫成只驗證 response header。
- `ENGINEERING_READY=true`、`PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false` 與 `releaseDecision=NO_GO` 維持不變。

## Next safe action

保留目前 local Browser `PASS` 的完整 evidence；下一個安全工作是由 owner 依核准流程補齊 remote CI、actual staging lineage／migration／recovery／rollback、外部 provider、PayUni Sandbox、政策與人工 acceptance。這些 gate 未完成前，不得升級 readiness 或 release decision。
