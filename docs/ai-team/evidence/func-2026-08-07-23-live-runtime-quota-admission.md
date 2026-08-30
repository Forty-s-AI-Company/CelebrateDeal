# FUNC-2026-08-07-23：直播 runtime quota admission 本機 closure

驗證時間：2026-08-07 14:46（Asia/Taipei）  
狀態：`LOCAL_FUNCTIONAL_CLOSURE`，不是 staging、PayUni 或人工 release acceptance。

## 這輪實際修正

- `quotaPolicy` 的 `maxConcurrentViewers` 與 `stopWhenCreditsBelow` 不再只是設定值；新增短生命週期 `LiveViewerSession`，由 server 在 `Serializable` transaction 中執行 admission。
- session 只保存 raw token 的 SHA-256 hash，瀏覽器 token 只透過 HttpOnly cookie 傳遞；同一 live 的既有 session 只刷新 expiry，不重複佔用 viewer slot。
- 同一 vendor／live 的 active viewer 數達到上限時 fail closed；當 server-owned `VendorUsageLimit` 有正數 `creditsLimit` 且剩餘點數低於門檻時，新的 admission 會被拒絕。未配置可計費額度時不把「未配置」偽裝成已驗證的 credits evidence。
- 公開 `/live/[slug]` 在 admission 完成前不暴露可播放 source；阻擋畫面會覆蓋 video、導覽、商品與表單操作。新增 `/api/live-admission` 的同源、client header、rate limit 與 generic error boundary。

## 實際驗證

| 檢查 | 實際結果 |
|---|---|
| targeted Vitest | 9 files、246 tests PASS；0 failed、0 skipped |
| live playback component regression | 26/26 PASS |
| `npm run typecheck` | PASS |
| scoped ESLint | 0 errors |
| `npm run secret:scan` | `secret_scan_passed` |
| disposable PostgreSQL migration | 23/23 migrations；Prisma validate/deploy/status、container/temp cleanup 全 PASS |
| scoped `git diff --check` | 無實際 diff error；僅 LF/CRLF normalization warning |

## 為什麼總分仍是 73.5

這輪完成的是可上線販售功能的本機 runtime closure，不是新的外部驗收。canonical readiness 仍為 `73.5`：CAT04 `6.0`、CAT10 `4.5`，本輪 current score change 為 `0`。

真正能推高總分的缺口仍是：

- CAT04：fresh staging reconciliation 與 PayUni Sandbox provider receipt。
- CAT10：真人 merchant、客服 SLA、法務／隱私／退款、財務與 release owner acceptance，以及 external monitoring evidence。

deterministic local tests 不能替代上述外部或真人證據；因此沒有把 246 個通過測試硬換算成分數。這也是跑了很久但數字沒有跳動的核心原因：前幾輪多數是在補產品與品質 gate，scorecard 的兩個瓶頸卻仍是外部邊界與人工簽核。

本輪未執行 staging、PayUni Sandbox、正式付款／退款、Production、部署或人工簽核；未讀取 Secret 或 production data；未重試 FIN-08AA、WP-196、WP-197；未降低 coverage threshold、inventory、exclude、skip 或 assertion。

完整 sanitized machine-readable receipt：`.ai-team/reports/func-2026-08-07-23-live-runtime-quota-admission.json`。
