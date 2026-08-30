# FUNC-2026-08-07-19：公開直播 direct-entry affiliate attribution closure

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_LOCAL_FUNCTIONAL_CLOSURE_SCORE_UNCHANGED`

## 修正的真實產品缺口

既有公開 `/live/[slug]` 頁面在沒有 `ref` 或 `sourcePage` 時，可能讓瀏覽器保留的舊 `celebratedeal_attribution` cookie 繼續進入 checkout。這會讓使用者直接輸入平台網址時，仍被錯誤歸給先前的 affiliate。

本輪新增：

- `POST /api/affiliate-attribution/direct-entry`：同源、trusted web marker、60/min rate limit、`Cache-Control: no-store`。
- 只清除 server-issued HttpOnly attribution cookie，不清除 visitor identity cookie。
- `LivePlayback` 在 direct entry（`ref`／`sourcePage` 都不存在或空白）時呼叫 reset route；有 referral context 時不呼叫。
- API contract registry 與 architecture route inventory 更新為 31/31，並補同路徑測試。

## 驗證結果

- 相關 targeted Vitest：5 files、62/62 PASS，包含 architecture gate、reset route、LivePlayback attribution classification、checkout regression 與 team attribution regression。
- 完整 Vitest：187 files、1335/1335 PASS、0 failed、0 skipped。
- Node contract suite：679/679 PASS、0 failed、0 skipped。
- WP168／WP170 synthetic fixture regression：29/29 PASS。
- `npm run typecheck`：PASS。
- `npm run lint`：exit 0；只有既有 `scripts/wp130-cloudflare-stream-webhook-contract-runner.mjs` 兩個 unused-vars warnings，沒有本輪新增 warning。
- `npm run secret:scan`：`secret_scan_passed`。
- `git diff --check`：PASS；只有 LF/CRLF normalization warning。

## Coverage、分數與邊界

本輪沒有重跑全域 coverage；上一個 authoritative QUAL-18 結果仍為 statements `40.65%`、branches `46.46%`、functions `49.16%`、lines `61.08%`，對既有 `63% / 57% / 60% / 65%` gate，沒有修改 threshold、inventory、exclude、skip 或 assertion。

CAT04 `6.0`、CAT10 `4.5`、total `73.5` 維持不變。CAT04 仍缺 fresh staging reconciliation 與 PayUni Sandbox/provider receipt；CAT10 仍缺真人商家、客服、法務／隱私／退款、財務、release owner 與 external monitoring acceptance。

沒有啟動 Next server、Browser、PostgreSQL、staging、PayUni 或 Production；沒有讀取 `.env*`、credential、Token、Cookie、正式 Secret、正式資料或付款資料；沒有重試 FIN-08AA、FIN-08AB、WP-196、WP-197 或任何既有 terminal external path。

## 附帶安全修正

WP168／WP170 的兩個 synthetic mismatch fixture 改成 loopback `127.0.0.1` 與 `*_test` database name，保留原本 `DB_SUPABASE_PROJECT_MISMATCH` assertions。這不是 scanner allow marker、exclude 或 threshold 放寬；修正後 `secret_scan_passed`，29/29 fixture tests 仍通過。

下一個高價值本機功能候選為 API registry 的 API-C01：checkout caller idempotency key 與 concurrent duplicate checkout contract。
