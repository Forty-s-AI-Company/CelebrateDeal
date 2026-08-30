# FUNC-2026-08-07-22：直播聯盟規則與販售 attribution 本機 closure

驗證時間：2026-08-07 14:28（Asia/Taipei）  
狀態：`LOCAL_FUNCTIONAL_CLOSURE`，不是 staging、PayUni 或人工 release acceptance。

## 這輪實際修正

- 直播建立／編輯頁的 `affiliateMode`、`defaultAffiliateCode`、觀看上限與點數停止門檻，現在由 server action 以版本化 `quotaPolicy` 持久化並回讀。
- 啟用 legacy attribution 時，click route 可使用 live default referral code。
- 停用 legacy attribution 時，click、form submission、checkout 都 fail closed；不解析 legacy code、不建立 sticky attribution cookie、不把來源寫入付款交易或 provider payload。
- Team Funnel 的 `sourcePage` attribution 保持獨立，不因停用 legacy `ref` 而被錯誤關閉。
- 保留 `LiveStepperForm` 原有 shallow DOM contract，並抽離 validation helper 以維持 lint complexity 門檻。

## 實際驗證

| 檢查 | 實際結果 |
|---|---|
| targeted Vitest | 6 files、211 tests PASS；0 failed、0 skipped |
| `npm run typecheck` | PASS |
| scoped ESLint | 0 errors |
| `npm run secret:scan` | `secret_scan_passed` |
| component regression | `src/components/live-stepper-form.test.tsx` 11/11 PASS |
| scoped `git diff --check` | 無實際 diff error；僅 LF/CRLF normalization warning |
| `node scripts/readiness-truth-reconciliation.mjs` | status PASS、10 categories、canonical total 73.5、SANDBOX_READY=false、PRODUCTION_READY=false |

## 為什麼總分仍是 73.5

本輪是可上線販售功能的本機 bug closure，不是新的外部驗收證據。canonical readiness 仍為 `73.5`：CAT04 `6.0`、CAT10 `4.5`，本輪 current score change 為 `0`。

reconciliation runner 目前輸出的 `score_change=0.5` 是歷史 WP-131 欄位，不是本次執行增加 0.5 分；完整 machine-readable receipt 已明確標記這個欄位，避免把歷史增量誤讀成今日加分。

CAT04 仍缺 fresh staging reconciliation 與 PayUni provider receipt；CAT10 仍缺真人 merchant/support/legal/privacy/refund/finance/release owner evidence 與 external monitoring。這些不能用 deterministic local tests 或 AI 文字簽核替代。

本輪未執行 staging、PayUni Sandbox、正式付款／退款、Production、部署或人工簽核；未重試 FIN-08AA、WP-196、WP-197，未降低 coverage threshold、inventory、exclude、skip 或 assertion，也未讀取 Secret 或 production data。

完整 sanitized machine-readable receipt：`.ai-team/reports/func-2026-08-07-22-live-quota-affiliate-closure.json`。
